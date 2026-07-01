import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"
import { createServer } from "http"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// Microsoft Entra ID / Microsoft Account OAuth2/OIDC endpoints.
// Tenant is substituted at runtime: common | organizations | consumers | {tenant-id}
const MICROSOFT_LOGIN_HOST = "https://login.microsoftonline.com"

// Default to the OneInfo Consulting Azure AD tenant.
// Override via tenant option or env var for other tenants.
const COMPANY_TENANT = "3219b5f9-900d-4608-80c8-7cd86886de3"
const DEFAULT_TENANT = COMPANY_TENANT

// Public client registered in the OneInfo Consulting Azure AD tenant.
// Override via MICROSOFT_CLIENT_ID env var or clientId option.
const CLIENT_ID = "cb06d541-ed31-4195-b7ff-d2b50084da6f"

const DEFAULT_SCOPES = "openid email profile offline_access"

// Microsoft requires the redirect_uri to match exactly what was registered in
// the Azure AD app registration. Pinning to a single known origin+port avoids
// having to update the AAD registration for every deployment.
const OAUTH_HOST = "127.0.0.1"
const OAUTH_PORT = 53800
const OAUTH_REDIRECT_PATH = "/callback"
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`

// Bounds for the device-code poll loop. Microsoft returns `interval` (seconds)
// but we floor it to avoid hammering and we add the spec's slow_down increment.
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 15 * 60 * 1000
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

// Refresh the access token a little before it actually expires so a single
// long-running tool call doesn't have to recover from a mid-flight 401.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

// OAuth callback rejects if the user doesn't complete authorization in time.
const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

interface MicrosoftAuthPluginOptions {
  tenant?: string
  clientId?: string
  scopes?: string
  redirectUri?: string
}

export interface MicrosoftConfig {
  tenant: string
  clientId: string
  scopes: string
  redirectUri: string
}

function getConfig(options: MicrosoftAuthPluginOptions = {}): MicrosoftConfig {
  return {
    tenant: options.tenant ?? DEFAULT_TENANT,
    clientId: options.clientId ?? process.env["MICROSOFT_CLIENT_ID"] ?? CLIENT_ID,
    scopes: options.scopes ?? DEFAULT_SCOPES,
    redirectUri: options.redirectUri ?? REDIRECT_URI,
  }
}

interface PkceCodes {
  verifier: string
  challenge: string
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(64)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

// --- ID Token Parsing ---

export interface MicrosoftIdToken {
  oid?: string
  sub?: string
  tid?: string
  exp?: number
  preferred_username?: string
}

export function parseJwtClaims(token: string): MicrosoftIdToken | undefined {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return undefined
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

export function extractAccountId(tokens: TokenResponse): string | undefined {
  // Microsoft ID token `oid` is the stable account identifier (preferred).
  // Fall back to `sub` if `oid` is absent (e.g. personal Microsoft accounts
  // that may use sub as the primary identifier).
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    if (claims?.oid) return claims.oid
    if (claims?.sub) return claims.sub
  }
  // Microsoft access tokens are also JWTs and may carry `oid`.
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    if (claims?.oid) return claims.oid
    if (claims?.sub) return claims.sub
  }
  return undefined
}

// Parse the `exp` claim out of a JWT access_token without verifying the
// signature. We only use this to decide whether to proactively refresh, never
// to make trust decisions, so unsigned decode is safe. Returns false for
// opaque tokens (no JWT shape), which conservatively skips the proactive
// refresh and lets the 401-on-call path drive the refresh instead.
export function accessTokenIsExpiring(
  token: string | undefined,
  skewMs: number = ACCESS_TOKEN_REFRESH_SKEW_MS,
): boolean {
  if (!token || typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length < 2) return false
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    while (payload.length % 4 !== 0) payload += "="
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"))
    if (typeof claims?.exp !== "number") return false
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs)
  } catch {
    return false
  }
}

// --- Token Shapes ---

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  message?: string
}

interface DeviceTokenErrorBody {
  error?: string
  error_description?: string
}

// --- HTTP Helpers ---

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
  }
}

// --- Tenant-derived Endpoints ---

function tenantUrl(tenant: string, path: string): string {
  return `${MICROSOFT_LOGIN_HOST}/${tenant}${path}`
}

// --- PKCE + OAuth Helpers ---

export function buildAuthorizeUrl(
  tenant: string,
  pkce: PkceCodes,
  state: string,
  clientId: string,
  scopes: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    prompt: "select_account",
  })
  return `${tenantUrl(tenant, "/oauth2/v2.0/authorize")}?${params.toString()}`
}

async function exchangeCodeForTokens(
  code: string,
  pkce: PkceCodes,
  config: MicrosoftConfig,
): Promise<TokenResponse> {
  const response = await fetch(tenantUrl(config.tenant, "/oauth2/v2.0/token"), {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Microsoft token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

async function refreshAccessToken(
  refreshToken: string,
  config: MicrosoftConfig,
): Promise<TokenResponse> {
  const response = await fetch(tenantUrl(config.tenant, "/oauth2/v2.0/token"), {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      scope: config.scopes,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Microsoft token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

// --- Device Code Flow ---

export async function requestDeviceCode(config: MicrosoftConfig): Promise<DeviceCodeResponse> {
  const response = await fetch(tenantUrl(config.tenant, "/oauth2/v2.0/devicecode"), {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Microsoft device code request failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  const json = (await response.json()) as DeviceCodeResponse
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("Microsoft device code response is missing device_code / user_code / verification_uri")
  }
  return json
}

// Default sleep used between device-code polls. Test-injectable so we can
// exercise authorization_pending / slow_down branches without real waits.
async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// Normalize a server-supplied seconds value to milliseconds, falling back to
// the supplied default when the input is missing, non-positive, or not a
// finite number.
function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

export async function pollDeviceCodeToken(
  device: DeviceCodeResponse,
  config: MicrosoftConfig,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<TokenResponse> {
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())
  const expiresInMs = positiveSecondsToMs(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS)
  const deadline = now() + expiresInMs
  let intervalMs = Math.max(
    positiveSecondsToMs(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS),
    DEVICE_CODE_MIN_INTERVAL_MS,
  )

  while (now() < deadline) {
    const response = await fetch(tenantUrl(config.tenant, "/oauth2/v2.0/token"), {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: config.clientId,
        device_code: device.device_code,
      }).toString(),
    })
    if (response.ok) return (await response.json()) as TokenResponse

    const body = (await response.json().catch(() => ({}))) as DeviceTokenErrorBody
    const remaining = Math.max(0, deadline - now())
    // RFC 8628 §3.5: authorization_pending = keep polling at the same
    // interval; slow_down = bump the interval by ≥5s and keep polling.
    // Anything else is terminal.
    if (body.error === "authorization_pending") {
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "slow_down") {
      intervalMs += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS
      await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, remaining))
      continue
    }
    if (body.error === "access_denied" || body.error === "authorization_declined") {
      throw new Error("Microsoft device authorization was denied")
    }
    if (body.error === "expired_token") {
      throw new Error("Microsoft device code expired - please re-run login")
    }
    const detail = body.error_description ?? body.error ?? ""
    throw new Error(`Microsoft device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  throw new Error("Microsoft device authorization timed out")
}

// --- Loopback Server ---

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>OpenCode - Microsoft Authorization Successful</title>
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

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - Microsoft Authorization Failed</title>
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

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined
// Captured when waitForOAuthCallback is called so the server handler
// (created once and reused) can access the per-request config.
let pendingOAuthConfig: MicrosoftConfig | undefined

export async function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) return { port: OAUTH_PORT, redirectUri: REDIRECT_URI }

  const server = createServer((req, res) => {
    const reqUrl = req.url || "/"
    const url = new URL(reqUrl, `http://${OAUTH_HOST}:${OAUTH_PORT}`)

    if (url.pathname === OAUTH_REDIRECT_PATH) {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        resetPendingOAuth()
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!code) {
        const errorMsg = "Missing authorization code"
        pendingOAuth?.reject(new Error(errorMsg))
        resetPendingOAuth()
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        const errorMsg = "Invalid state - potential CSRF attack"
        pendingOAuth?.reject(new Error(errorMsg))
        resetPendingOAuth()
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(HTML_ERROR(errorMsg))
        return
      }

      const current = pendingOAuth
      const config = pendingOAuthConfig
      resetPendingOAuth()

      if (!config) {
        current.reject(new Error("Microsoft OAuth config not available"))
        res.writeHead(500, { "Content-Type": "text/html" })
        res.end(HTML_ERROR("Configuration error"))
        return
      }

      exchangeCodeForTokens(code, current.pkce, config)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_SUCCESS)
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      resetPendingOAuth()
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  // listen() failures (e.g. EADDRINUSE) must clear `oauthServer` so the
  // next startOAuthServer() doesn't short-circuit returning a dead redirect.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      oauthServer = undefined
      reject(err)
    }
    server.once("error", onError)
    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      server.removeListener("error", onError)
      server.on("error", (err) => console.warn("microsoft oauth server error", { error: err }))
      console.log("microsoft oauth server started", { host: OAUTH_HOST, port: OAUTH_PORT })
      resolve()
    })
    oauthServer = server
  })

  return { port: OAUTH_PORT, redirectUri: REDIRECT_URI }
}

function resetPendingOAuth() {
  pendingOAuth = undefined
  pendingOAuthConfig = undefined
}

export function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close(() => console.log("microsoft oauth server stopped"))
    oauthServer = undefined
  }
}

export function waitForOAuthCallback(
  pkce: PkceCodes,
  state: string,
  config: MicrosoftConfig,
): Promise<TokenResponse> {
  // Reject any prior pending OAuth that the user abandoned.
  if (pendingOAuth) {
    pendingOAuth.reject(new Error("Superseded by a newer Microsoft authorize request"))
    resetPendingOAuth()
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          resetPendingOAuth()
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      OAUTH_CALLBACK_TIMEOUT_MS,
    )

    pendingOAuthConfig = config
    pendingOAuth = {
      pkce,
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

// --- Token Refresh Result ---

interface RefreshResult {
  access: string
  refresh: string
  expires: number
}

// --- Plugin ---

function requireClientId(config: MicrosoftConfig): string {
  if (!config.clientId) {
    throw new Error(
      "Microsoft client ID is required. " +
      "Set MICROSOFT_CLIENT_ID environment variable or pass `clientId` in plugin options. " +
      "Register an Azure AD app (public client/native) at " +
      "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade " +
      "with redirect URI: " + REDIRECT_URI,
    )
  }
  return config.clientId
}

export async function MicrosoftAuthPlugin(
  input: PluginInput,
  options: MicrosoftAuthPluginOptions = {},
): Promise<Hooks> {
  const config = getConfig(options)

  return {
    auth: {
      provider: "microsoft",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        // Single-flight refresh: collapse concurrent fetches onto one HTTP call.
        let refreshPromise: Promise<RefreshResult> | undefined

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let currentAuth = await getAuth()
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            const expiresSoon =
              !currentAuth.expires ||
              currentAuth.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
              accessTokenIsExpiring(currentAuth.access)
            if (expiresSoon) {
              if (!refreshPromise) {
                const refreshToken = currentAuth.refresh
                console.log("refreshing microsoft access token")
                refreshPromise = refreshAccessToken(refreshToken, config)
                  .then(async (tokens) => {
                    const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
                    const refreshedRefresh = tokens.refresh_token || refreshToken
                    const accountId = extractAccountId(tokens) || currentAuth.accountId
                    await input.client.auth
                      .set({
                        path: { id: "microsoft" },
                        body: {
                          type: "oauth",
                          access: tokens.access_token,
                          refresh: refreshedRefresh,
                          expires: refreshedExpires,
                          ...(accountId && { accountId }),
                        },
                      })
                      .catch((err) =>
                        console.warn("failed to persist refreshed microsoft tokens", { error: err }),
                      )
                    return {
                      access: tokens.access_token,
                      refresh: refreshedRefresh,
                      expires: refreshedExpires,
                    }
                  })
                  .finally(() => {
                    refreshPromise = undefined
                  })
              }
              const refreshed = await refreshPromise
              currentAuth = { ...currentAuth, ...refreshed }
            }

            const headers = new Headers(
              requestInput instanceof Request ? requestInput.headers : undefined,
            )
            if (init?.headers) {
              const entries =
                init.headers instanceof Headers
                  ? init.headers.entries()
                  : Array.isArray(init.headers)
                    ? init.headers
                    : Object.entries(init.headers as Record<string, string | undefined>)
              for (const [key, value] of entries) {
                if (value !== undefined) headers.set(key, String(value))
              }
            }
            headers.set("authorization", `Bearer ${currentAuth.access}`)
            headers.set("User-Agent", `opencode/${InstallationVersion}`)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "Microsoft Entra ID / Microsoft Account (Browser)",
          type: "oauth",
          authorize: async () => {
            requireClientId(config)
            await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(
              config.tenant,
              pkce,
              state,
              config.clientId,
              config.scopes,
            )

            const callbackPromise = waitForOAuthCallback(pkce, state, config)

            return {
              url: authUrl,
              instructions:
                "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await callbackPromise
                  const accountId = extractAccountId(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    ...(accountId && { accountId }),
                  }
                } catch (err) {
                  console.error("microsoft oauth callback failed", { error: err })
                  return { type: "failed" as const }
                } finally {
                  stopOAuthServer()
                }
              },
            }
          },
        },
        {
          label: "Microsoft Entra ID / Microsoft Account (Headless / Remote / VPS)",
          type: "oauth",
          authorize: async () => {
            requireClientId(config)
            const device = await requestDeviceCode(config)
            const browserUrl = device.verification_uri_complete ?? device.verification_uri
            return {
              url: browserUrl,
              instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await pollDeviceCodeToken(device, config)
                  const accountId = extractAccountId(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    ...(accountId && { accountId }),
                  }
                } catch (err) {
                  console.error("microsoft device code callback failed", { error: err })
                  return { type: "failed" as const }
                }
              },
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
