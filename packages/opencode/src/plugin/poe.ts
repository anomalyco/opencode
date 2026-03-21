import type { AuthOuathResult, Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.poe" })

const CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea"
const AUTHORIZE_URL = "https://poe.com/oauth/authorize"
const TOKEN_URL = "https://api.poe.com/token"
const SCOPE = "apikey:create"

export interface PkceCodes {
  verifier: string
  challenge: string
}

export interface PoeTokenResponse {
  api_key: string
  api_key_expires_in?: number | null | undefined
}

interface PendingOAuth {
  pkce: PkceCodes
  redirectUri: string
  state: string
  resolve: PromiseWithResolvers<PoeTokenResponse>["resolve"]
  reject: PromiseWithResolvers<PoeTokenResponse>["reject"]
}

let oauthServer: Bun.Server<undefined> | undefined
let pendingOAuth: PendingOAuth | undefined

export function resetPoeOAuthForTest() {
  pendingOAuth = undefined
  stopOAuthServer()
}

export function getPoeExpiry(value: PoeTokenResponse): number {
  if (value.api_key_expires_in == null) return Number.MAX_SAFE_INTEGER
  return Date.now() + value.api_key_expires_in * 1000
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

async function exchangeCodeForApiKey(code: string, redirectUri: string, pkce: PkceCodes): Promise<PoeTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return (await response.json()) as PoeTokenResponse
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenCode - Poe Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenCode.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

export const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - Poe Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${escapeHtml(error)}</div>
    </div>
  </body>
</html>`

async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (pendingOAuth) throw new Error("Poe login already in progress")

  if (oauthServer) {
    if (oauthServer.port == null) throw new Error("Failed to determine Poe OAuth server port")
    return {
      port: oauthServer.port,
      redirectUri: `http://127.0.0.1:${oauthServer.port}/callback`,
    }
  }

  oauthServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const description = url.searchParams.get("error_description")

        if (error) {
          const msg = description || error
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          stopOAuthServer()
          return new Response(HTML_ERROR(msg), {
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!code) {
          const msg = "Missing authorization code"
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          stopOAuthServer()
          return new Response(HTML_ERROR(msg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!pendingOAuth) {
          const msg = "Invalid state - potential CSRF attack"
          stopOAuthServer()
          return new Response(HTML_ERROR(msg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (state !== pendingOAuth.state) {
          const msg = "Invalid state - potential CSRF attack"
          pendingOAuth.reject(new Error(msg))
          pendingOAuth = undefined
          stopOAuthServer()
          return new Response(HTML_ERROR(msg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        const current = pendingOAuth
        pendingOAuth = undefined

        exchangeCodeForApiKey(code, current.redirectUri, current.pkce)
          .then((result) => current.resolve(result))
          .catch((err) => current.reject(err))

        return new Response(HTML_SUCCESS, {
          headers: { "Content-Type": "text/html" },
        })
      }

      if (url.pathname === "/cancel") {
        pendingOAuth?.reject(new Error("Login cancelled"))
        pendingOAuth = undefined
        stopOAuthServer()
        return new Response(HTML_ERROR("Login cancelled"), {
          headers: { "Content-Type": "text/html" },
        })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  const port = oauthServer.port
  if (port == null) throw new Error("Failed to determine Poe OAuth server port")
  log.info("poe oauth server started", { port })
  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
  }
}

function stopOAuthServer() {
  if (!oauthServer) return
  oauthServer.stop()
  oauthServer = undefined
  log.info("poe oauth server stopped")
}

function waitForOAuthCallback(pkce: PkceCodes, state: string, redirectUri: string): Promise<PoeTokenResponse> {
  return new Promise((resolve, reject) => {
    if (pendingOAuth) {
      reject(new Error("Poe login already in progress"))
      return
    }

    const timeout = setTimeout(
      () => {
        if (!pendingOAuth) return
        pendingOAuth = undefined
        stopOAuthServer()
        reject(new Error("OAuth callback timeout - authorization took too long"))
      },
      5 * 60 * 1000,
    )

    pendingOAuth = {
      pkce,
      redirectUri,
      state,
      resolve: (result) => {
        clearTimeout(timeout)
        stopOAuthServer()
        resolve(result)
      },
      reject: (error) => {
        clearTimeout(timeout)
        stopOAuthServer()
        reject(error)
      },
    }
  })
}

export async function PoeAuthPlugin(input: PluginInput): Promise<Hooks> {
  void input
  return {
    auth: {
      provider: "poe",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type === "api") {
          return {
            apiKey: auth.key,
          }
        }
        if (auth.type !== "oauth") return {}
        if (auth.expires < Date.now()) {
          throw new Error("Poe API key expired. Run `opencode providers login` again.")
        }
        return {
          apiKey: auth.access,
        }
      },
      methods: [
        {
          label: "Login with Poe (browser)",
          type: "oauth",
          authorize: async (): Promise<AuthOuathResult> => {
            const { redirectUri } = await startOAuthServer()

            try {
              const pkce = await generatePKCE()
              const state = generateState()
              const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)
              const callbackPromise = waitForOAuthCallback(pkce, state, redirectUri)

              try {
                const child = await (await import("open")).default(authUrl)
                await new Promise<void>((resolve, reject) => {
                  const timeout = setTimeout(resolve, 500)
                  child.on("error", (err) => {
                    clearTimeout(timeout)
                    reject(err)
                  })
                  child.on("exit", (code) => {
                    if (code === null || code === 0) return
                    clearTimeout(timeout)
                    reject(new Error(`Browser open failed with exit code ${code}`))
                  })
                })
              } catch (error) {
                log.warn("failed to open poe oauth browser, user must open url manually", {
                  error,
                })
              }

              return {
                url: authUrl,
                instructions: "Complete authorization in your browser. This window will close automatically.",
                method: "auto" as const,
                callback: async () => {
                  try {
                    const result = await callbackPromise
                    return {
                      type: "success" as const,
                      refresh: result.api_key,
                      access: result.api_key,
                      expires: getPoeExpiry(result),
                    }
                  } finally {
                    stopOAuthServer()
                  }
                },
              }
            } catch (error) {
              stopOAuthServer()
              throw error
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
