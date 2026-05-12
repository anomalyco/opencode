import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk/v2"
import * as Log from "@opencode-ai/core/util/log"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { createServer } from "http"

const log = Log.create({ service: "plugin.digitalocean" })

const DO_OAUTH_CLIENT_ID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const DO_AUTHORIZE_URL = "https://cloud.digitalocean.com/v1/oauth/authorize"
const DO_API_BASE = "https://api.digitalocean.com"
const DO_INFERENCE_BASE = "https://inference.do-ai.run/v1"
const OAUTH_PORT = 1456
const OAUTH_REDIRECT_PATH = "/auth/callback"
const OAUTH_TOKEN_PATH = "/auth/token"
const ROUTER_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const MAK_NAME_PREFIX = "opencode-oauth"

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

interface ApiKeyInfo {
  uuid: string
  name: string
  secret_key: string
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
    scope: "read write",
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
        try {
          const body = error
            ? { error, error_description: errorDescription || "" }
            : { access_token: params.get("access_token") || "", expires_in: params.get("expires_in") || "0", state: params.get("state") || "" }
          await fetch(${JSON.stringify(OAUTH_TOKEN_PATH)}, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
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
      log.info("digitalocean oauth server started", { port: OAUTH_PORT })
      resolve()
    })
    oauthServer!.on("error", reject)
  })
}

function stopOAuthServer() {
  if (!oauthServer) return
  oauthServer.close(() => log.info("digitalocean oauth server stopped"))
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

async function createModelAccessKey(bearer: string): Promise<ApiKeyInfo> {
  // Suffix-on-collision strategy keeps re-`/connect` non-destructive.
  const name = `${MAK_NAME_PREFIX}-${Math.floor(Date.now() / 1000)}`
  const res = await fetch(`${DO_API_BASE}/v2/gen-ai/models/api_keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      "User-Agent": `opencode/${InstallationVersion}`,
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Failed to create Model Access Key (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { api_key_info?: ApiKeyInfo }
  if (!data.api_key_info?.secret_key) throw new Error("Model Access Key response missing secret_key")
  return data.api_key_info
}

async function listRouters(bearer: string): Promise<{ ok: true; routers: RouterEntry[] } | { ok: false; status: number }> {
  const res = await fetch(`${DO_API_BASE}/v2/gen-ai/models/routers`, {
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
    return parsed.flatMap((r) => (r && typeof r.name === "string" ? [{ name: r.name, uuid: r.uuid, description: r.description }] : []))
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
              .catch((err) => log.warn("failed to persist refreshed routers", { error: err }))
          } else if (result.status === 401 || result.status === 403) {
            log.warn("digitalocean oauth bearer rejected; using cached routers", { status: result.status })
          } else if (result.status !== 0) {
            log.warn("digitalocean router refresh failed", { status: result.status })
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
            return {
              url: buildAuthorizeUrl(state),
              instructions:
                "Sign in to DigitalOcean in your browser. OpenCode will create a Model Access Key named opencode-oauth-* and load your Inference Routers. Re-run /connect to refresh routers later.",
              method: "auto" as const,
              async callback() {
                try {
                  const tokens = await callbackPromise
                  const apiKeyInfo = await createModelAccessKey(tokens.access_token)
                  const routerResult = await listRouters(tokens.access_token)
                  const routers = routerResult.ok ? routerResult.routers : []
                  if (!routerResult.ok) {
                    log.warn("digitalocean initial router fetch failed", { status: routerResult.status })
                  }
                  return {
                    type: "success" as const,
                    provider: "digitalocean",
                    key: apiKeyInfo.secret_key,
                    metadata: {
                      mak_uuid: apiKeyInfo.uuid,
                      mak_name: apiKeyInfo.name,
                      oauth_access: tokens.access_token,
                      oauth_expires: String(Date.now() + tokens.expires_in * 1000),
                      routers: JSON.stringify(
                        routers.map((r) => ({ name: r.name, uuid: r.uuid, description: r.description })),
                      ),
                      routers_fetched_at: String(Date.now()),
                    },
                  }
                } catch (err) {
                  log.error("digitalocean oauth callback failed", { error: err })
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
