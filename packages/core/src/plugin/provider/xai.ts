import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect, Schema } from "effect"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

// Public Grok-CLI OAuth client. xAI's auth server rejects loopback OAuth from
// non-allowlisted clients, so we reuse the Grok-CLI client_id that xAI ships
// for desktop OAuth flows. Source of truth: hermes-agent PR #26534.
const clientID = "b1a00492-073a-47ea-816f-4c329264a828"
const defaultAuthorizeURL = "https://auth.x.ai/oauth2/authorize"
const defaultTokenURL = "https://auth.x.ai/oauth2/token"
// RFC 8628 device authorization grant. Confirmed exposed by xAI's
// /.well-known/openid-configuration as `device_authorization_endpoint`.
const defaultDeviceAuthorizationURL = "https://auth.x.ai/oauth2/device/code"
const deviceCodeGrant = "urn:ietf:params:oauth:grant-type:device_code"
const scope = "openid profile email offline_access grok-cli:access api:access"

// xAI rejects redirect_uris that don't match what was registered for the
// Grok-CLI client. The host:port pair is part of the registration.
const oauthHost = "127.0.0.1"
const oauthPort = 56121
const oauthRedirectPath = "/callback"
const redirectURI = `http://${oauthHost}:${oauthPort}${oauthRedirectPath}`
const corsAllowedOrigins = new Set(["https://accounts.x.ai", "https://auth.x.ai"])

const deviceDefaultIntervalMs = 5_000
const deviceMinIntervalMs = 1_000
const deviceSlowDownIncrementMs = 5_000
const deviceDefaultExpiresMs = 5 * 60 * 1000
const pollingSafetyMarginMs = 3_000
// Refresh a little before the real deadline so resolve does not hand the
// runner a token that dies mid-flight. Matches v1's 120s proactive skew.
const accessTokenRefreshSkewMs = 120_000
const defaultAccessTtlSeconds = 3600

const browserMethodID = Integration.MethodID.make("browser")
const headlessMethodID = Integration.MethodID.make("headless")

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

/** Optional endpoint overrides for unit tests with a local mock server. */
export type XaiOAuthEndpoints = {
  authorizeURL?: string
  tokenURL?: string
  deviceAuthorizationURL?: string
  /** Floor for device poll interval. Defaults to 1s. Tests may set 0. */
  deviceMinIntervalMs?: number
  /** Extra wait added after each pending/slow_down. Defaults to 3s. */
  pollingSafetyMarginMs?: number
  /** RFC 8628 minimum slow_down bump. Defaults to 5s. Tests may set 0. */
  deviceSlowDownIncrementMs?: number
}

// Keep required device fields strict; leave interval/expires_in untyped so
// positiveSecondsToMs can coerce string/NaN garbage the same way v1 does.
const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Unknown),
  interval: Schema.optional(Schema.Unknown),
})

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Unknown),
})

const DeviceTokenError = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Unknown),
})

/** Build browser + headless SuperGrok OAuth method registrations. */
export function oauthMethods(endpoints: XaiOAuthEndpoints = {}) {
  const authorizeURL = endpoints.authorizeURL ?? defaultAuthorizeURL
  const tokenURL = endpoints.tokenURL ?? defaultTokenURL
  const deviceAuthorizationURL = endpoints.deviceAuthorizationURL ?? defaultDeviceAuthorizationURL
  const minIntervalMs = endpoints.deviceMinIntervalMs ?? deviceMinIntervalMs
  const safetyMarginMs = endpoints.pollingSafetyMarginMs ?? pollingSafetyMarginMs
  const slowDownIncrementMs = endpoints.deviceSlowDownIncrementMs ?? deviceSlowDownIncrementMs

  const browser = {
    integrationID: Integration.ID.make("xai"),
    method: {
      id: browserMethodID,
      type: "oauth",
      label: "xAI Grok OAuth (SuperGrok Subscription)",
    },
    authorize: (_inputs) =>
      Effect.gen(function* () {
        const pkce = yield* Effect.promise(generatePKCE)
        const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
        const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
        const code = yield* Deferred.make<string, Error>()
        const server = createServer((request, response) => {
          const origin = request.headers.origin
          const allowOrigin = typeof origin === "string" && corsAllowedOrigins.has(origin) ? origin : ""
          if (allowOrigin) {
            response.setHeader("Access-Control-Allow-Origin", allowOrigin)
            response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
            response.setHeader("Access-Control-Allow-Headers", "Content-Type")
            response.setHeader("Access-Control-Allow-Private-Network", "true")
            response.setHeader("Vary", "Origin")
          }
          if (request.method === "OPTIONS") {
            response.writeHead(204).end()
            return
          }

          const url = new URL(request.url ?? "/", `http://${oauthHost}:${oauthPort}`)
          if (url.pathname !== oauthRedirectPath) {
            response.writeHead(404).end("Not found")
            return
          }

          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(code, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: "xAI" }))
            return
          }
          if (!value || url.searchParams.get("state") !== state) {
            const message = value ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(code, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "xAI" }))
            return
          }
          Effect.runFork(Deferred.succeed(code, value))
          response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: "xAI" }))
        })
        yield* Effect.callback<void, Error>((resume) => {
          server.once("error", (error) => resume(Effect.fail(error)))
          server.listen(oauthPort, oauthHost, () => resume(Effect.void))
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        return {
          mode: "auto" as const,
          url: buildAuthorizeURL(pkce, state, nonce, authorizeURL),
          instructions: "Complete authorization in your browser. This window will close automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) => exchange(value, pkce, tokenURL)),
            Effect.map((tokens) => credential(browserMethodID, tokens)),
          ),
        }
      }),
    refresh: (value) => refresh(browserMethodID, value, tokenURL),
  } satisfies IntegrationOAuthMethodRegistration

  const headless = {
    integrationID: Integration.ID.make("xai"),
    method: {
      id: headlessMethodID,
      type: "oauth",
      label: "xAI Grok OAuth (Headless / Remote / VPS)",
    },
    authorize: (_inputs) =>
      Effect.gen(function* () {
        const device = yield* request(deviceAuthorizationURL, {
          method: "POST",
          headers: headers(),
          body: new URLSearchParams({ client_id: clientID, scope }).toString(),
        }).pipe(Effect.map(Schema.decodeUnknownSync(Device)))
        const interval = Math.max(positiveSecondsToMs(device.interval, deviceDefaultIntervalMs), minIntervalMs)
        const expiresInMs = positiveSecondsToMs(device.expires_in, deviceDefaultExpiresMs)
        const deadline = Date.now() + expiresInMs

        const poll = (wait: number): Effect.Effect<Credential.OAuth, unknown> =>
          Effect.gen(function* () {
            if (Date.now() >= deadline) return yield* Effect.fail(new Error("xAI device authorization timed out"))
            const remaining = Math.max(0, deadline - Date.now())
            const response = yield* Effect.tryPromise({
              try: (signal) =>
                fetch(tokenURL, {
                  method: "POST",
                  headers: headers(),
                  body: new URLSearchParams({
                    grant_type: deviceCodeGrant,
                    client_id: clientID,
                    device_code: device.device_code,
                  }).toString(),
                  signal,
                }),
              catch: (cause) => cause,
            })
            if (response.ok) {
              const tokens = Schema.decodeUnknownSync(Token)(yield* Effect.promise(() => response.json()))
              if (!tokens.refresh_token) {
                return yield* Effect.fail(new Error("xAI device token response is missing refresh_token"))
              }
              return credential(headlessMethodID, {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_in: numberOrUndefined(tokens.expires_in),
              })
            }
            const body = Schema.decodeUnknownSync(DeviceTokenError)(
              yield* Effect.promise(() => response.json().catch(() => ({}))),
            )
            if (body.error === "authorization_pending") {
              yield* Effect.sleep(Math.min(wait + safetyMarginMs, remaining))
              return yield* poll(wait)
            }
            if (body.error === "slow_down") {
              const next = Math.max(
                positiveSecondsToMs(body.interval, wait + slowDownIncrementMs),
                wait + slowDownIncrementMs,
              )
              yield* Effect.sleep(Math.min(next + safetyMarginMs, remaining))
              return yield* poll(next)
            }
            if (body.error === "access_denied" || body.error === "authorization_denied") {
              return yield* Effect.fail(new Error("xAI device authorization was denied"))
            }
            if (body.error === "expired_token") {
              return yield* Effect.fail(new Error("xAI device code expired - please re-run login"))
            }
            const detail = body.error_description ?? body.error ?? ""
            return yield* Effect.fail(
              new Error(`xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`),
            )
          })

        return {
          mode: "auto" as const,
          url: device.verification_uri_complete ?? device.verification_uri,
          instructions: `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`,
          callback: poll(interval),
        }
      }),
    refresh: (value) => refresh(headlessMethodID, value, tokenURL),
  } satisfies IntegrationOAuthMethodRegistration

  return { browser, headless }
}

export const XAIPlugin = define({
  id: "opencode.provider.xai",
  effect: Effect.fn(function* (ctx) {
    const methods = oauthMethods()
    yield* ctx.integration.transform((draft) => {
      draft.method.update(methods.browser)
      draft.method.update(methods.headless)
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/xai") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
        evt.sdk = mod.createXai(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("xai")) return
        evt.language = evt.sdk.responses(evt.model.modelID ?? evt.model.id)
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

/** Build the SuperGrok authorize URL. Exported for unit tests. */
export function buildAuthorizeURL(
  pkce: Pkce,
  state: string,
  nonce: string,
  authorizeURL: string = defaultAuthorizeURL,
) {
  // `plan=generic` opts the consent screen into xAI's generic OAuth plan tier;
  // without it, accounts.x.ai rejects loopback OAuth from non-allowlisted
  // clients. `referrer=opencode` lets xAI attribute opencode-originated logins.
  return `${authorizeURL}?${new URLSearchParams({
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirectURI,
    scope,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "opencode",
  })}`
}

/** Normalize a server-supplied seconds value to ms. Exported for unit tests. */
export function positiveSecondsToMs(value: unknown, defaultMs: number) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs
}

/**
 * Absolute expiry timestamp for a stored OAuth credential.
 * Prefers a positive `expires_in`, else JWT `exp`, else a 1h default.
 * Subtracts the refresh skew so Integration.resolve refreshes before mid-flight expiry.
 */
export function credentialExpires(
  access: string,
  expiresIn: unknown,
  now: number = Date.now(),
  skewMs: number = accessTokenRefreshSkewMs,
) {
  const fromExpiresIn = positiveSecondsToMs(expiresIn, 0)
  if (fromExpiresIn > 0) return now + fromExpiresIn - Math.max(0, skewMs)
  const exp = accessTokenExp(access)
  if (exp !== undefined) return exp * 1000 - Math.max(0, skewMs)
  return now + defaultAccessTtlSeconds * 1000 - Math.max(0, skewMs)
}

/**
 * Parse the `exp` claim out of a JWT access_token without verifying the
 * signature. Used only to schedule refresh, never for trust decisions.
 */
export function accessTokenExp(token: string | undefined): number | undefined {
  if (!token || typeof token !== "string") return undefined
  const parts = token.split(".")
  if (parts.length < 2) return undefined
  try {
    let payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/")
    while (payload.length % 4 !== 0) payload += "="
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { exp?: unknown }
    return typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp : undefined
  } catch {
    return undefined
  }
}

function headers() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
  }
}

function exchange(code: string, pkce: Pkce, tokenURL: string) {
  return request<TokenResponse>(tokenURL, {
    method: "POST",
    headers: headers(),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectURI,
      client_id: clientID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
}

function refresh(
  methodID: Integration.MethodID,
  value: Pick<Credential.OAuth, "refresh" | "metadata">,
  tokenURL: string,
) {
  return request<TokenResponse>(tokenURL, {
    method: "POST",
    headers: headers(),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }).toString(),
  }).pipe(
    Effect.map((tokens) => {
      // Apply the refresh-token fallback before Credential.OAuth.make validates
      // required fields. xAI may omit refresh_token on refresh responses.
      const next = credential(methodID, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || value.refresh,
        expires_in: tokens.expires_in,
      })
      return Credential.OAuth.make({
        ...next,
        metadata: next.metadata ?? value.metadata,
      })
    }),
  )
}

function request<A>(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(`Request failed: ${response.status}${detail ? `: ${detail}` : ""}`)
      }
      return response.json() as Promise<A>
    },
    catch: (cause) => cause,
  })
}

function credential(methodID: Integration.MethodID, tokens: TokenResponse) {
  if (!tokens.refresh_token) {
    throw new Error("xAI token response is missing refresh_token")
  }
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: credentialExpires(tokens.access_token, tokens.expires_in),
  })
}

function numberOrUndefined(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}
