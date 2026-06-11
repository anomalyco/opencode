import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createServer } from "http"
import open from "open"

const DO_OAUTH_CLIENT_ID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const DO_AUTHORIZE_URL = "https://cloud.digitalocean.com/v1/oauth/authorize"
const DO_API_BASE = "https://api.digitalocean.com"
const DO_GENAI_API = `${DO_API_BASE}/v2/gen-ai`
const DO_INFERENCE_BASE = "https://inference.do-ai.run/v1"
const OAUTH_PORT = 1456
const OAUTH_REDIRECT_PATH = "/auth/callback"
const OAUTH_TOKEN_PATH = "/auth/token"
const ROUTER_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const OAUTH_SCOPES = "genai:read inference:query"

interface ImplicitTokenPayload {
  access_token: string
  expires_in: number
  state: string
}

interface PendingOAuth {
  state: string
  resolve: (tokens: ImplicitTokenPayload) => void
  reject: (error: Error) => void
}

interface RouterEntry {
  name: string
  uuid?: string
  description?: string
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function redirectUri(): string {
  return `http://localhost:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`
}

function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "token",
    client_id: DO_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES,
    state,
  })
  return `${DO_AUTHORIZE_URL}?${params.toString()}`
}

const HTML_CALLBACK = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OpenCode - DigitalOcean Authorization</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0b1220; color: #e8eef9; }
      .container { text-align: center; padding: 2rem; max-width: 32rem; }
      h1 { color: #e8eef9; margin-bottom: 1rem; }
      p { color: #9aa9c0; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem; padding: 1rem; background: #3c140d; border-radius: 0.5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 id="title">Finishing sign-in...</h1>
      <p id="msg">You can close this window once it says you're signed in.</p>
    </div>
    <script>
      (async function() {
        const params = new URLSearchParams((window.location.hash || "").slice(1))
        const search = new URLSearchParams(window.location.search)
        const error = params.get("error") || search.get("error")
        const errorDescription = params.get("error_description") || search.get("error_description")
        const titleEl = document.getElementById("title")
        const msgEl = document.getElementById("msg")
        const tokenUrl = new URL(${JSON.stringify(OAUTH_TOKEN_PATH)}, window.location.origin).href
        try {
          const body = error
            ? { error, error_description: errorDescription || "" }
            : { access_token: params.get("access_token") || "", expires_in: params.get("expires_in") || "0", state: params.get("state") || "" }
          const res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const detail = await res.text().catch(function () { return "" })
            throw new Error(detail || ("callback failed (" + res.status + ")"))
          }
          if (error) {
            titleEl.textContent = "Authorization Failed"
            msgEl.textContent = errorDescription || error
            msgEl.className = "error"
            return
          }
          titleEl.textContent = "Authorization Successful"
          msgEl.textContent = "You can close this window and return to OpenCode."
          setTimeout(function () { window.close() }, 2000)
        } catch (e) {
          titleEl.textContent = "Authorization Failed"
          msgEl.textContent = String(e && e.message ? e.message : e)
          msgEl.className = "error"
        }
      })()
    </script>
  </body>
</html>`

async function startOAuthServer(): Promise<void> {
  if (oauthServer) return
  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (req.method === "GET" && url.pathname === OAUTH_REDIRECT_PATH) {
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_CALLBACK)
      return
    }

    if (req.method === "POST" && url.pathname === OAUTH_TOKEN_PATH) {
      const chunks: Buffer[] = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8")
        let body: Record<string, string> = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          body = {}
        }
        if (!pendingOAuth) {
          res.writeHead(409, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "no_pending_oauth" }))
          return
        }
        if (body.error) {
          const message = body.error_description || body.error || "OAuth error"
          pendingOAuth.reject(new Error(String(message)))
          pendingOAuth = undefined
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true }))
          return
        }
        if (!body.access_token) {
          pendingOAuth.reject(new Error("Missing access_token in callback"))
          pendingOAuth = undefined
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "missing_access_token" }))
          return
        }
        if (body.state !== pendingOAuth.state) {
          pendingOAuth.reject(new Error("Invalid state - potential CSRF attack"))
          pendingOAuth = undefined
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "invalid_state" }))
          return
        }
        const expires = parseInt(body.expires_in || "0", 10)
        pendingOAuth.resolve({
          access_token: body.access_token,
          expires_in: Number.isFinite(expires) && expires > 0 ? expires : 60 * 60 * 24 * 30,
          state: body.state,
        })
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  await new Promise<void>((resolve, reject) => {
    oauthServer!.listen(OAUTH_PORT, () => {
      resolve()
    })
    oauthServer!.on("error", reject)
  })
}

function stopOAuthServer() {
  if (!oauthServer) return
  oauthServer.close()
  oauthServer = undefined
}

function waitForOAuthCallback(state: string): Promise<ImplicitTokenPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    )
    pendingOAuth = {
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

async function listRouters(
  bearer: string,
): Promise<{ ok: true; routers: RouterEntry[] } | { ok: false; status: number }> {
  const res = await fetch(`${DO_GENAI_API}/models/routers`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      "User-Agent": `opencode/${InstallationVersion}`,
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  if (!res) return { ok: false, status: 0 }
  if (!res.ok) return { ok: false, status: res.status }
  const body = (await res.json().catch(() => undefined)) as { model_routers?: RouterEntry[] } | undefined
  return { ok: true, routers: body?.model_routers ?? [] }
}

function routerModel(router: RouterEntry, providerID: string): Model {
  const id = `router:${router.name}`
  return {
    id,
    providerID,
    name: router.name,
    family: "digitalocean-inference-routers",
    api: { id, url: DO_INFERENCE_BASE, npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

function parseRoutersJSON(raw: string | undefined): RouterEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((r) =>
      r && typeof r.name === "string" ? [{ name: r.name, uuid: r.uuid, description: r.description }] : [],
    )
  } catch {
    return []
  }
}

export async function DigitalOceanAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    provider: {
      id: "digitalocean",
      async models(provider, ctx) {
        const baseModels = provider.models
        if (ctx.auth?.type !== "api") return baseModels

        const metadata = ctx.auth.metadata ?? {}
        const oauthAccess = metadata["oauth_access"]
        const oauthExpires = parseInt(metadata["oauth_expires"] || "0", 10)
        const fetchedAt = parseInt(metadata["routers_fetched_at"] || "0", 10)
        const cached = parseRoutersJSON(metadata["routers"])

        let routers = cached
        const stale = Date.now() - fetchedAt > ROUTER_REFRESH_INTERVAL_MS
        const bearerValid = oauthAccess && oauthExpires > Date.now()

        if (bearerValid && stale) {
          const result = await listRouters(oauthAccess)
          if (result.ok) {
            routers = result.routers
            const updated: Record<string, string> = {
              ...metadata,
              routers: JSON.stringify(routers.map((r) => ({ name: r.name, uuid: r.uuid, description: r.description }))),
              routers_fetched_at: String(Date.now()),
            }
            await input.client.auth
              .set({
                path: { id: "digitalocean" },
                body: { type: "api", key: ctx.auth.key, metadata: updated },
              })
              .catch(() => {})
          } else if (result.status === 401 || result.status === 403) {
          } else if (result.status !== 0) {
          }
        }

        const merged: Record<string, Model> = { ...baseModels }
        for (const router of routers) {
          const id = `router:${router.name}`
          if (merged[id]) continue
          merged[id] = routerModel(router, "digitalocean")
        }
        return merged
      },
    },
    auth: {
      provider: "digitalocean",
      methods: [
        {
          type: "oauth",
          label: "Login with DigitalOcean",
          async authorize() {
            await startOAuthServer()
            const state = generateState()
            const callbackPromise = waitForOAuthCallback(state)
            const url = buildAuthorizeUrl(state)
            await open(url).catch(() => undefined)
            return {
              url,
              instructions:
                "Sign in to DigitalOcean in your browser. OpenCode will use your DigitalOcean API token directly for inference and load your Inference Routers. Re-run /connect to refresh routers later.",
              method: "auto" as const,
              async callback() {
                try {
                  const tokens = await callbackPromise
                  const routerResult = await listRouters(tokens.access_token)
                  const routers = routerResult.ok ? routerResult.routers : []
                  if (!routerResult.ok) {
                  }
                  return {
                    type: "success" as const,
                    provider: "digitalocean",
                    key: tokens.access_token,
                    metadata: {
                      oauth_access: tokens.access_token,
                      oauth_expires: String(Date.now() + tokens.expires_in * 1000),
                      oauth_scopes: OAUTH_SCOPES,
                      routers: JSON.stringify(
                        routers.map((r) => ({ name: r.name, uuid: r.uuid, description: r.description })),
                      ),
                      routers_fetched_at: String(Date.now()),
                    },
                  }
                } catch (err) {
                  return { type: "failed" as const }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "Paste Model Access Key",
        },
      ],
    },
  }
}
