/**
 * OAuth flow executor for webfetch authentication.
 *
 * Supports:
 * - Authorization Code + PKCE / RFC 7636 (interactive, opens browser)
 * - Device Authorization Grant / RFC 8628 (headless/SSH)
 * - Dynamic Client Registration / RFC 7591
 *
 * Key RFC compliance points:
 * - RFC 7636 §4.1: code_verifier uses unreserved chars, 43-128 characters
 * - RFC 7636 §4.2: S256 challenge = BASE64URL(SHA256(verifier))
 * - RFC 8628 §3.5: slow_down MUST increase interval by 5 seconds
 * - RFC 7591 §2: client registration request format
 * - RFC 6749 §5.2: error response format for token endpoint
 *
 * Security: All operational endpoint fetches (token exchange, registration,
 * device authorization, token polling) use redirect: "error" to prevent a
 * malicious AS from redirecting POST bodies containing sensitive credentials
 * (auth codes, PKCE verifiers, client secrets, device codes) to internal
 * services or attacker-controlled endpoints.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7636.html
 * @see https://www.rfc-editor.org/rfc/rfc8628.html
 * @see https://www.rfc-editor.org/rfc/rfc7591.html
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { requireHttps, isLoopback, type ASMetadata, type ResourceMetadata } from "./discovery"
import { Log } from "../util/log"

// ---------------------------------------------------------------------------
// Interaction interface — user-facing touchpoints
// ---------------------------------------------------------------------------

export interface Interaction {
  /** Ask user for consent before authenticating. Reject to deny. */
  askConsent(info: { resource: string; server: string; scopes?: string[] }): Promise<void>

  /** The user needs to visit this URL to authorize. The consumer decides how. */
  openUrl(url: string): Promise<void>

  /** A device code flow requires the user to visit a URL and enter a code. */
  showDeviceCode(info: { verification_uri: string; user_code: string }): Promise<void>
}

// ---------------------------------------------------------------------------
// CallbackServer interface — OAuth redirect receiver
// ---------------------------------------------------------------------------

export interface CallbackServer {
  /** Start the server. Returns the redirect URI the AS should send the user back to. */
  start(): Promise<{ redirectUri: string }>

  /**
   * Wait for the authorization code callback.
   * The implementation is responsible for state/CSRF validation.
   * Must reject on timeout or error. Must call stop() internally on completion.
   */
  waitForCode(expectedState: string): Promise<string>

  /** Stop the server and clean up. Safe to call multiple times. */
  stop(): Promise<void>
}

// ---------------------------------------------------------------------------
// ClientRegistration — client identity for dynamic registration
// ---------------------------------------------------------------------------

export interface ClientRegistration {
  name: string
  uri?: string
  clientId?: string
  clientSecret?: string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// LocalCallbackServer — default CallbackServer using node:http
// ---------------------------------------------------------------------------

export interface LocalCallbackServerOptions {
  port?: number
  hostname?: string
  path?: string
  portRetries?: number
  timeout?: number
  html?: {
    success?: string
    error?: (msg: string) => string
  }
}

/**
 * Escape HTML special characters to prevent XSS injection.
 * Error messages from authorization servers are untrusted input and
 * MUST be escaped before interpolation into HTML.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const DEFAULT_SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>OpenCode - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to OpenCode.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

function defaultErrorHtml(error: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>OpenCode - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
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
}

export class LocalCallbackServer implements CallbackServer {
  private server?: Server
  private port: number
  private hostname: string
  private callbackPath: string
  private portRetries: number
  private timeout: number
  private successHtml: string
  private errorHtml: (msg: string) => string

  constructor(opts?: LocalCallbackServerOptions) {
    this.port = opts?.port ?? 19877
    this.hostname = opts?.hostname ?? "127.0.0.1"
    this.callbackPath = opts?.path ?? "/oauth/callback"
    this.portRetries = opts?.portRetries ?? 10
    this.timeout = opts?.timeout ?? 300000
    this.successHtml = opts?.html?.success ?? DEFAULT_SUCCESS_HTML
    this.errorHtml = opts?.html?.error ?? defaultErrorHtml
  }

  async start(): Promise<{ redirectUri: string }> {
    for (let i = 0; i < this.portRetries; i++) {
      const candidate = this.port + i
      try {
        await this.listen(candidate)
        this.port = candidate
        return { redirectUri: `http://${this.hostname}:${candidate}${this.callbackPath}` }
      } catch {
        continue
      }
    }
    throw new Error("could not find open port for callback server")
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.on("error", reject)
      srv.listen(port, this.hostname, () => {
        this.server = srv
        resolve()
      })
    })
  }

  waitForCode(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const srv = this.server!
      let done = false
      const finish = (cb: () => void, close: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        srv.off("request", onRequest)
        if (close) setTimeout(() => this.stop(), 500)
        cb()
      }
      const timer = setTimeout(() => {
        finish(() => {
          void this.stop()
          reject(new Error("authorization callback timed out"))
        }, false)
      }, this.timeout)

      const onRequest = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url!, `http://${this.hostname}:${this.port}`)
        if (url.pathname !== this.callbackPath) {
          res.writeHead(404)
          res.end("Not found")
          return
        }

        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const desc = url.searchParams.get("error_description")

        // CSRF check — state must match
        if (!state || state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end(this.errorHtml("Invalid state parameter"))
          return
        }

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(this.errorHtml(desc ?? error))
          // Delay cleanup so the HTTP response is fully delivered
          finish(() => reject(new Error(`Authorization error: ${desc ?? error}`)), true)
          return
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end(this.errorHtml("No authorization code"))
          finish(() => reject(new Error("No authorization code in callback")), true)
          return
        }

        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(this.successHtml)
        // Delay cleanup so the HTTP response is fully delivered to the browser
        // before the server shuts down. Without this, the user sees a connection
        // reset error instead of the success/error page.
        finish(() => resolve(code), true)
      }

      srv.on("request", onRequest)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const srv = this.server
    this.server = undefined
    return new Promise((resolve) => {
      srv.close(() => resolve())
    })
  }
}

// ---------------------------------------------------------------------------
// PKCE — RFC 7636 §4.1-§4.2
// ---------------------------------------------------------------------------

/**
 * RFC 7636 §4.1: code_verifier character set validation.
 * code-verifier = 43*128unreserved
 * unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 */
const PKCE_RE = /^[A-Za-z0-9\-._~]{43,128}$/

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  // Use a loop instead of String.fromCharCode(...bytes) to avoid
  // stack overflow on large buffers (spread hits the call-stack argument limit).
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Generate PKCE code_verifier and code_challenge per RFC 7636 §4.1-§4.2.
 *
 * The verifier is 32 cryptographically random bytes encoded as base64url,
 * producing a 43-character string (minimum per RFC 7636 §4.1).
 * The challenge is BASE64URL(SHA256(ASCII(verifier))) per Appendix A.
 */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
  if (!PKCE_RE.test(verifier)) throw new Error("PKCE verifier generation produced invalid value")
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64url(hash)
  return { verifier, challenge }
}

/** Generate a cryptographically random state parameter (32 bytes, base64url). */
export function state(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration — RFC 7591
// ---------------------------------------------------------------------------

export type ClientInfo = {
  client_id: string
  client_secret?: string
}

export function tokenEndpointHeaders(
  metadata: Pick<ASMetadata, "token_endpoint_auth_methods_supported">,
  client: ClientInfo,
  body: URLSearchParams,
  logger: Log.Logger = Log.create({ service: "webfetch-auth" }),
): Record<string, string> | undefined {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  }

  // Public clients authenticate only by identifying themselves to the token endpoint.
  if (!client.client_secret) {
    body.set("client_id", client.client_id)
    return headers
  }

  const methods = metadata.token_endpoint_auth_methods_supported ?? ["client_secret_basic"]
  if (methods.includes("client_secret_basic")) {
    headers.Authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`, "utf-8").toString("base64")}`
    return headers
  }
  if (methods.includes("client_secret_post")) {
    body.set("client_id", client.client_id)
    body.set("client_secret", client.client_secret)
    return headers
  }

  logger.error("token endpoint auth method unsupported", {
    client_id: client.client_id,
    methods,
  })
  return undefined
}

export type TokenResult = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  client: ClientInfo
}

/**
 * Register a client dynamically per RFC 7591 §2.
 *
 * Sends a registration request to the AS's registration_endpoint with
 * metadata about the client (redirect URIs, name, grant types).
 * Uses token_endpoint_auth_method "none" (public client).
 *
 * @see https://www.rfc-editor.org/rfc/rfc7591.html#section-2
 */
export async function register(
  metadata: ASMetadata,
  redirectUri: string,
  registration: ClientRegistration,
  logger: Log.Logger = Log.create({ service: "webfetch-auth" }),
  signal?: AbortSignal,
): Promise<ClientInfo | undefined> {
  if (!metadata.registration_endpoint) return undefined

  // Validate registration endpoint is HTTPS (or HTTP loopback)
  if (!requireHttps(metadata.registration_endpoint)) {
    logger.error("registration_endpoint must be HTTPS", { url: metadata.registration_endpoint })
    return undefined
  }

  logger.info("attempting dynamic client registration", { endpoint: metadata.registration_endpoint })

  // redirect: "error" prevents a malicious AS from redirecting the POST to an
  // internal service, which would forward client metadata to the redirect target.
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "error",
    signal,
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: registration.name,
      ...(registration.uri && { client_uri: registration.uri }),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }).catch(() => undefined)

  if (!response || !response.ok) {
    logger.info("dynamic registration failed", { status: response?.status })
    return undefined
  }

  const body = (await response.json().catch(() => undefined)) as
    | { client_id: string; client_secret?: string; client_secret_expires_at?: number }
    | undefined
  if (!body || !body.client_id) return undefined

  // RFC 7591 §3.2.1: client_secret_expires_at — if the server issued an
  // expiring secret, reject it because we have no renewal mechanism.
  // A value of 0 means the secret does not expire.
  if (body.client_secret_expires_at && body.client_secret_expires_at > 0) {
    logger.info("dynamic registration returned expiring client_secret, rejecting", {
      client_id: body.client_id,
      expires_at: body.client_secret_expires_at,
    })
    return undefined
  }

  logger.info("dynamic registration succeeded", { client_id: body.client_id })
  return { client_id: body.client_id, client_secret: body.client_secret }
}

/**
 * Maximum device code grant lifetime in seconds.
 *
 * RFC 8628 does not define an upper bound for expires_in, so a malicious AS
 * could return an absurdly large value (e.g. 999999999 ≈ 31 years) causing
 * the poll loop to run effectively forever. Cap at 10 minutes which covers
 * all mainstream providers (GitHub 15 min, Azure 15 min, Google 30 min use
 * shorter user_code lifetimes in practice) while preventing abuse.
 */
export const MAX_DEVICE_CODE_LIFETIME = 600

// ---------------------------------------------------------------------------
// Token response type — RFC 6749 §5.1-§5.2
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token?: string
  token_type?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
  error_uri?: string
}

// ---------------------------------------------------------------------------
// Authorization Code + PKCE — RFC 6749 §4.1, RFC 7636
// ---------------------------------------------------------------------------

/**
 * Execute the Authorization Code + PKCE flow.
 *
 * 1. Start the callback server to get the redirect URI
 * 2. Register the client if needed (deferred until port is known)
 * 3. Build the authorization URL with PKCE challenge and state
 * 4. Open the URL via the Interaction interface
 * 5. Wait for the callback with the authorization code
 * 6. Exchange the code for tokens at the token endpoint
 *
 * @see https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1
 * @see https://www.rfc-editor.org/rfc/rfc7636.html
 * @see https://www.rfc-editor.org/rfc/rfc8707.html (resource parameter)
 */
export async function authorizationCode(
  resource: string,
  resourceMeta: ResourceMetadata,
  asMeta: ASMetadata,
  client: ClientInfo | undefined,
  scopes: string[] | undefined,
  opts: {
    server: CallbackServer
    interaction: Interaction
    registration: ClientRegistration
    logger?: Log.Logger
    signal?: AbortSignal
  },
): Promise<TokenResult | undefined> {
  const log = opts.logger ?? Log.create({ service: "webfetch-auth" })

  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) {
    log.error("AS missing required endpoints", { issuer: asMeta.issuer })
    return undefined
  }

  // Defense-in-depth: validate endpoint schemes even though fetchASMetadata
  // already checks. Protects against callers that construct ASMetadata manually.
  if (!requireHttps(asMeta.authorization_endpoint)) {
    log.error("authorization_endpoint must be HTTPS", { url: asMeta.authorization_endpoint })
    return undefined
  }
  if (!requireHttps(asMeta.token_endpoint)) {
    log.error("token_endpoint must be HTTPS", { url: asMeta.token_endpoint })
    return undefined
  }

  const codes = await pkce()
  const st = state()
  const scope = scopes?.join(" ") ?? resourceMeta.scopes_supported?.join(" ") ?? ""

  let resolved = client

  // Start callback server FIRST to get the actual redirect URI
  let redirectUri: string
  try {
    const started = await opts.server.start()
    redirectUri = started.redirectUri
  } catch (err) {
    log.error("failed to start callback server", { error: String(err) })
    return undefined
  }

  // Deferred registration: register with the actual redirect URI
  if (!resolved && asMeta.registration_endpoint) {
    resolved = (await register(asMeta, redirectUri, opts.registration, log, opts.signal)) ?? undefined
  }
  if (!resolved) {
    log.error("no client available for authorization code flow")
    await opts.server.stop()
    return undefined
  }

  // Build authorization URL
  const params = new URLSearchParams({
    response_type: "code",
    client_id: resolved.client_id,
    redirect_uri: redirectUri,
    state: st,
    code_challenge: codes.challenge,
    code_challenge_method: "S256",
  })
  if (scope) params.set("scope", scope)
  // RFC 8707: request audience-restricted tokens
  params.set("resource", resourceMeta.resource)
  const authUrl = `${asMeta.authorization_endpoint}?${params.toString()}`

  // Validate authorization URL scheme before opening.
  // A malicious authorization_endpoint (e.g. file:///..., custom-scheme://...)
  // could trigger unintended behavior via the OS URL handler.
  const authOrigin = new URL(authUrl).hostname
  if (!authUrl.startsWith("https://") && !(authUrl.startsWith("http://") && isLoopback(authOrigin))) {
    log.error("authorization URL must use HTTPS", { url: authUrl })
    await opts.server.stop()
    return undefined
  }

  // Open URL via the Interaction interface — consumer decides how
  try {
    await opts.interaction.openUrl(authUrl)
  } catch (err) {
    log.error("failed to open authorization URL", { error: String(err) })
    await opts.server.stop()
    throw err
  }

  // Log only the host — the full URL contains the state parameter and
  // code_challenge which, while not secret, could be exploited by an
  // attacker with access to aggregated logs + the callback server.
  log.info("opened authorization URL", { host: new URL(authUrl).host })

  // Wait for the callback with the authorization code
  let code: string
  try {
    code = await opts.server.waitForCode(st)
  } catch {
    return undefined
  }

  // Exchange code for tokens — RFC 6749 §4.1.3
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codes.verifier,
  })
  // RFC 8707 §2.2: include resource parameter at the token endpoint to
  // audience-restrict the access token. RFC 9728 §7.4 RECOMMENDS this.
  body.set("resource", resourceMeta.resource)
  const headers = tokenEndpointHeaders(asMeta, resolved, body, log)
  if (!headers) return undefined

  // redirect: "error" prevents a malicious AS from redirecting the token
  // exchange POST to an internal service, leaking auth codes, PKCE verifiers,
  // and client secrets to the redirect target.
  const response = await fetch(asMeta.token_endpoint, {
    method: "POST",
    headers,
    redirect: "error",
    signal: opts.signal,
    body: body.toString(),
  }).catch(() => undefined)

  if (!response) {
    log.error("token exchange network error")
    return undefined
  }

  // RFC 6749 §5.2: parse error response
  const tokens = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !tokens.access_token) {
    log.error("token exchange failed", {
      status: response.status,
      error: tokens.error,
      description: tokens.error_description,
    })
    return undefined
  }

  // RFC 6749 §5.1: token_type is REQUIRED and MUST be "Bearer" (case-insensitive)
  if (!tokens.token_type || tokens.token_type.toLowerCase() !== "bearer") {
    log.error("token response missing or unsupported token_type", {
      type: tokens.token_type,
    })
    return undefined
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    scope: tokens.scope ?? scope,
    client: resolved,
  }
}

// ---------------------------------------------------------------------------
// Device Authorization Grant — RFC 8628
// ---------------------------------------------------------------------------

export type DeviceInfo = {
  verification_uri: string
  user_code: string
}

/**
 * Initiate the Device Authorization Grant per RFC 8628 §3.1-§3.2.
 *
 * Returns device info for the user to visit a URL and enter a code,
 * plus a poll() function that polls the token endpoint.
 *
 * Key compliance point — RFC 8628 §3.5:
 * When the server returns "slow_down", the client MUST increase the
 * polling interval by 5 seconds for ALL subsequent requests.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8628.html
 */
export async function deviceCode(
  resource: string,
  resourceMeta: ResourceMetadata,
  asMeta: ASMetadata,
  client: ClientInfo,
  scopes?: string[],
  logger?: Log.Logger,
  signal?: AbortSignal,
): Promise<{ info: DeviceInfo; poll: () => Promise<TokenResult | undefined> } | undefined> {
  const log = logger ?? Log.create({ service: "webfetch-auth" })

  if (!asMeta.device_authorization_endpoint || !asMeta.token_endpoint) {
    log.info("AS does not support device code flow", { issuer: asMeta.issuer })
    return undefined
  }

  // Defense-in-depth: validate endpoint schemes
  if (!requireHttps(asMeta.device_authorization_endpoint)) {
    log.error("device_authorization_endpoint must be HTTPS", { url: asMeta.device_authorization_endpoint })
    return undefined
  }
  if (!requireHttps(asMeta.token_endpoint)) {
    log.error("token_endpoint must be HTTPS", { url: asMeta.token_endpoint })
    return undefined
  }

  const scope = scopes?.join(" ") ?? resourceMeta.scopes_supported?.join(" ") ?? ""
  const body = new URLSearchParams({ client_id: client.client_id })
  if (scope) body.set("scope", scope)
  // RFC 8707: audience-restricted tokens
  body.set("resource", resourceMeta.resource)

  // redirect: "error" prevents a malicious AS from redirecting the device
  // authorization POST to an internal service, leaking the client_id and
  // resource parameters to the redirect target.
  const response = await fetch(asMeta.device_authorization_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "error",
    signal,
    body: body.toString(),
  }).catch(() => undefined)

  if (!response || !response.ok) {
    log.error("device authorization failed", { status: response?.status })
    return undefined
  }

  const data = (await response.json().catch(() => undefined)) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in?: number
    interval?: number
  } | undefined

  // RFC 8628 §3.2: device_code, user_code, verification_uri, and expires_in
  // are all REQUIRED fields. Reject responses missing any of them.
  if (!data || !data.device_code || !data.user_code || !data.verification_uri || data.expires_in == null) {
    if (data) log.error("device authorization response missing required fields", {
      has_device_code: !!data.device_code,
      has_user_code: !!data.user_code,
      has_verification_uri: !!data.verification_uri,
      has_expires_in: data.expires_in != null,
    })
    return undefined
  }

  // RFC 8628 §3.2: default polling interval is 5 seconds.
  // Clamp minimum to 1s to prevent tight-loop polling from a malicious AS.
  let interval = Math.max(data.interval ?? 5, 1) * 1000

  // Clamp expires_in to MAX_DEVICE_CODE_LIFETIME to prevent a malicious AS
  // from keeping the poll loop alive indefinitely (e.g. expires_in: 999999999).
  const raw = data.expires_in
  const lifetime = Math.min(Math.max(raw, 0), MAX_DEVICE_CODE_LIFETIME)
  if (raw > MAX_DEVICE_CODE_LIFETIME) {
    log.warn("device code expires_in exceeds maximum, clamping", {
      raw,
      clamped: MAX_DEVICE_CODE_LIFETIME,
    })
  }
  const deadline = Date.now() + lifetime * 1000

  // RFC 8628 §3.2: verification_uri_complete is optional and pre-fills the
  // user code for convenience. However, a malicious AS could set it to a
  // phishing URL on a different origin. Validate that its origin matches
  // verification_uri before using it; fall back to verification_uri otherwise.
  let uri = data.verification_uri
  if (data.verification_uri_complete) {
    const base = requireHttps(data.verification_uri)
    const complete = requireHttps(data.verification_uri_complete)
    if (base && complete && complete.origin === base.origin) {
      uri = data.verification_uri_complete
    } else {
      log.warn("verification_uri_complete origin mismatch, ignoring", {
        verification_uri: data.verification_uri,
        verification_uri_complete: data.verification_uri_complete,
      })
    }
  }

  const info: DeviceInfo = {
    verification_uri: uri,
    user_code: data.user_code,
  }

  async function poll(): Promise<TokenResult | undefined> {
    while (Date.now() < deadline) {
      await sleep(interval, signal).catch(() => undefined)
      if (signal?.aborted) return undefined

      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: data!.device_code,
      })
      const headers = tokenEndpointHeaders(asMeta, client, body, log)
      if (!headers) return undefined

      // redirect: "error" prevents a malicious AS from redirecting the device
      // code token poll to an internal service, leaking device_code and
      // client_id to the redirect target.
      const response = await fetch(asMeta.token_endpoint!, {
        method: "POST",
        headers,
        redirect: "error",
        signal,
        body: body.toString(),
      }).catch(() => undefined)

      // RFC 8628 §3.5: on connection timeout / network error, clients MUST
      // unilaterally reduce their polling frequency before retrying.
      // Uses exponential backoff (doubling) as RECOMMENDED by the RFC.
      if (!response) {
        interval = Math.min(interval * 2, 60000)
        continue
      }

      const json = (await response.json().catch(() => ({}))) as TokenResponse

      if (response.ok && json.access_token) {
        // RFC 6749 §5.1: token_type is REQUIRED
        if (!json.token_type || json.token_type.toLowerCase() !== "bearer") {
          log.error("device code token response missing or unsupported token_type", {
            type: json.token_type,
          })
          return undefined
        }
        return {
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_in: json.expires_in,
          scope: json.scope ?? scope,
          client,
        }
      }

      // RFC 8628 §3.5: "slow_down" — MUST increase interval by 5 seconds
      if (json.error === "slow_down") {
        interval += 5000
        continue
      }
      if (json.error === "authorization_pending") continue

      // RFC 8628 §3.5: any other error is a terminal failure.
      // Truncate untrusted AS error descriptions to prevent log injection.
      log.error("device code poll failed", {
        error: String(json.error ?? "").slice(0, 200),
        description: String(json.error_description ?? "").slice(0, 500),
        status: response.status,
      })
      return undefined
    }

    log.error("device code flow timed out")
    return undefined
  }

  return { info, poll }
}
