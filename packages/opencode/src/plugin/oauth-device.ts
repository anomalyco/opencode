import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { OAUTH_DUMMY_KEY } from "../auth"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// Generic RFC 8628 device-flow OAuth plugin. Unlike the xAI plugin (which is
// the reference implementation this is derived from), this plugin takes its
// endpoints / client_id / scope from the caller — it makes no assumptions
// about which OAuth server it is talking to. The intended use is a custom
// OpenAI-compatible gateway (e.g. an internal litellm-proxy) that exposes
// RFC 8628 device authorization + token endpoints and needs the same
// browser-based SSO UX that built-in providers get.
//
// There is intentionally no loopback callback server, no PKCE, and no
// `authorize_code` grant path here — the device flow is the only OAuth
// method exposed (alongside the standard "Manually enter API Key" fallback).
// A loopback server is meaningless for headless / VPS / SSH / CI use, and
// RFC 8628 was designed precisely for those environments.

// Default `client_id` sent in the device-authorization and token POSTs. Some
// OAuth servers require a pre-registered client_id; users can override this
// per-provider via `auth.clientId` in their opencode.json.
const DEFAULT_CLIENT_ID = "opencode"

// RFC 8628 device authorization grant type. Servers MUST accept this exact
// urn in the `grant_type` field of the token endpoint POST.
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

// Bounds for the device-code poll loop. RFC 8628 §3.5 says the server returns
// `interval` (seconds) but we floor it to avoid hammering and we add the
// spec's slow_down increment when the server explicitly asks us to back off.
const DEVICE_CODE_DEFAULT_INTERVAL_MS = 5_000
const DEVICE_CODE_MIN_INTERVAL_MS = 1_000
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5_000
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
// Extra safety margin added to each poll sleep so a slightly-too-fast client
// clock doesn't race ahead of the server's polling window.
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

// Refresh the access token a little before it actually expires so a single
// long-running tool call doesn't have to recover from a mid-flight 401.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 120_000

export interface OAuthDeviceProviderOptions {
  providerId: string
  label?: string
  deviceAuthorizationUrl: string
  tokenUrl: string
  clientId?: string
  scope?: string
}

interface DeviceFlowOptions {
  deviceAuthorizationUrl: string
  tokenUrl: string
  clientId: string
  scope?: string
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
  }
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

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

interface DeviceTokenErrorBody {
  error?: string
  error_description?: string
}

export async function requestDeviceCode(options: DeviceFlowOptions): Promise<DeviceCodeResponse> {
  const params: Record<string, string> = {
    client_id: options.clientId,
  }
  // Some OAuth servers reject an empty `scope=` form field; only emit it when
  // the caller actually configured one.
  if (options.scope) params.scope = options.scope
  const response = await fetch(options.deviceAuthorizationUrl, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams(params).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(
      `OAuth device code request failed for ${options.deviceAuthorizationUrl} (${response.status})${detail ? `: ${detail}` : ""}`,
    )
  }
  const json = (await response.json()) as DeviceCodeResponse
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("OAuth device code response is missing device_code / user_code / verification_uri")
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
// finite number. Defends the polling loop against garbage like `NaN`, `"NaN"`,
// `null`, or `-5` from a misbehaving device-code endpoint — without this,
// a NaN interval would slip through `?? default` (NaN is typeof number),
// reach `setTimeout(_, NaN)` which is treated as 0, and busy-loop until the
// hard deadline. Matches the defensive normalization Codex uses for the same
// field (`parseInt(deviceData.interval) || 5`).
function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

export async function pollDeviceCodeToken(
  device: DeviceCodeResponse,
  options: DeviceFlowOptions & { sleep?: (ms: number) => Promise<void>; now?: () => number },
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
    const response = await fetch(options.tokenUrl, {
      method: "POST",
      headers: authHeaders(),
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: options.clientId,
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
    if (body.error === "access_denied" || body.error === "authorization_denied") {
      throw new Error("OAuth device authorization was denied")
    }
    if (body.error === "expired_token") {
      throw new Error("OAuth device code expired - please re-run login")
    }
    const detail = body.error_description ?? body.error ?? ""
    throw new Error(`OAuth device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  throw new Error("OAuth device authorization timed out")
}

async function refreshAccessToken(refreshToken: string, options: DeviceFlowOptions): Promise<TokenResponse> {
  const response = await fetch(options.tokenUrl, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: options.clientId,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`OAuth token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

interface RefreshResult {
  access: string
  refresh: string
  expires: number
}

// Per-provider single-flight refresh state. Multiple plugin instances (one per
// configured provider) coexist in the same process; keying the map by
// providerId ensures instance A's in-flight refresh doesn't collapse
// instance B's concurrent refresh against a different refresh_token.
const refreshPromises = new Map<string, Promise<RefreshResult> | undefined>()

export async function OAuthDeviceProviderPlugin(
  input: PluginInput,
  options: OAuthDeviceProviderOptions,
): Promise<Hooks> {
  const flowOptions: DeviceFlowOptions = {
    deviceAuthorizationUrl: options.deviceAuthorizationUrl,
    tokenUrl: options.tokenUrl,
    clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    scope: options.scope,
  }
  const providerId = options.providerId

  return {
    auth: {
      provider: providerId,
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        return {
          // Dummy bearer keeps the AI SDK from bailing on "missing apiKey";
          // the real OAuth token is injected by the fetch override below.
          // We intentionally do NOT set baseURL — the user's
          // `options.baseURL` from their opencode.json provider config must
          // win, and overriding here would silently route around it.
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            let currentAuth = await getAuth()
            // Auth can flip from oauth to api mid-session (user re-runs
            // /connect with a pasted key). When that happens, pass the
            // request through untouched so the AI SDK's own apiKey-based
            // Authorization header reaches the gateway unmodified.
            if (currentAuth.type !== "oauth") return fetch(requestInput, init)

            // Refresh either when the stored expires timestamp is within the
            // skew window, or — for JWT access tokens — when the JWT exp
            // claim itself is. The stored expires field is best-effort
            // (servers don't always return expires_in) so the JWT check is
            // the load-bearing one for tokens that lack a fresh stored
            // deadline.
            const expiresSoon =
              !currentAuth.expires ||
              currentAuth.expires - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS ||
              accessTokenIsExpiring(currentAuth.access)
            if (expiresSoon) {
              let refreshPromise = refreshPromises.get(providerId)
              if (!refreshPromise) {
                const refreshToken = currentAuth.refresh
                refreshPromise = refreshAccessToken(refreshToken, flowOptions)
                  .then(async (tokens) => {
                    const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
                    const refreshedRefresh = tokens.refresh_token || refreshToken
                    // Persist the rotated pair as best-effort. The OAuth
                    // server has already consumed the old refresh_token by
                    // the time we get here; an auth.set failure leaves the
                    // on-disk state stale but the in-memory result is still
                    // valid for this turn. The next live refresh against the
                    // stale disk state will 4xx and force re-login — a known
                    // cross-process limitation.
                    await input.client.auth
                      .set({
                        path: { id: providerId },
                        body: {
                          type: "oauth",
                          access: tokens.access_token,
                          refresh: refreshedRefresh,
                          expires: refreshedExpires,
                        },
                      })
                      .catch(() => {})
                    return { access: tokens.access_token, refresh: refreshedRefresh, expires: refreshedExpires }
                  })
                  .finally(() => {
                    refreshPromises.set(providerId, undefined)
                  })
                refreshPromises.set(providerId, refreshPromise)
              }
              const refreshed = await refreshPromise
              currentAuth = { ...currentAuth, ...refreshed }
            }

            // Copy the caller's headers into a fresh Headers (case-insensitive)
            // so we never mutate the RequestInit the AI SDK may reuse on retry.
            // Headers.set overwrites case-insensitively, which kills the dummy
            // bearer the AI SDK injected from apiKey in a single line.
            const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
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
          // RFC 8628 device-code flow. The CLI prints a verification URL
          // and a short user_code that the user enters in a browser on any
          // device. No loopback callback server runs on the CLI host, so
          // this works on VPS / SSH / Docker / CI / WSL / any environment
          // where 127.0.0.1 isn't reachable from the user's browser.
          // Defends the only attack surface (the polling loop) with the
          // standard authorization_pending / slow_down backoff and a hard
          // deadline from the server's `expires_in`.
          label: options.label ?? `${providerId} OAuth (Device Flow)`,
          type: "oauth",
          authorize: async () => {
            const device = await requestDeviceCode(flowOptions)
            const browserUrl = device.verification_uri_complete ?? device.verification_uri
            return {
              url: browserUrl,
              instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await pollDeviceCodeToken(device, flowOptions)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  }
                } catch {
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
