import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Clock, Deferred, Effect, Option, Schema } from "effect"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"

const clientID = "b1a00492-073a-47ea-816f-4c329264a828"
const issuer = "https://auth.x.ai/oauth2"
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"
const scope = "openid profile email offline_access grok-cli:access api:access"
const callbackHost = "127.0.0.1"
const callbackPort = 56121
const callbackPath = "/callback"
const redirectURI = `http://${callbackHost}:${callbackPort}${callbackPath}`
const pollingSafetyMargin = 3000
const corsOrigins = new Set(["https://accounts.x.ai", "https://auth.x.ai"])
const browserMethodID = Integration.MethodID.make("browser")
const deviceMethodID = Integration.MethodID.make("device")

type Pkce = {
  verifier: string
  challenge: string
}

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
type Token = typeof Token.Type

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
})

const DeviceError = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
})
const decodeDeviceError = Schema.decodeUnknownOption(Schema.fromJsonString(DeviceError))

const browser = {
  integrationID: Integration.ID.make("xai"),
  method: {
    id: browserMethodID,
    type: "oauth",
    label: "xAI Grok OAuth (SuperGrok Subscription)",
  },
  authorize: () =>
    Effect.gen(function* () {
      const pkce = yield* Effect.promise(generatePKCE)
      const state = randomString(32)
      const code = yield* Deferred.make<string, Error>()
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", redirectURI)
        const origin = request.headers.origin
        if (origin && corsOrigins.has(origin)) {
          response.setHeader("Access-Control-Allow-Origin", origin)
          response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
          response.setHeader("Access-Control-Allow-Headers", "Content-Type")
          response.setHeader("Access-Control-Allow-Private-Network", "true")
          response.setHeader("Vary", "Origin")
        }
        if (request.method === "OPTIONS") {
          response.writeHead(204).end()
          return
        }
        if (url.pathname !== callbackPath) {
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
        server.listen(callbackPort, callbackHost, () => resume(Effect.void))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      return {
        mode: "auto" as const,
        url: authorizeURL(pkce, state, randomString(32)),
        instructions: "Complete authorization in your browser. This window will close automatically.",
        callback: Deferred.await(code).pipe(
          Effect.flatMap((value) => exchange(value, pkce)),
          Effect.flatMap((tokens) => credential(browserMethodID, tokens)),
        ),
      }
    }),
  refresh: (value) => refresh(browserMethodID, Credential.OAuth.make({ ...value, methodID: browserMethodID })),
} satisfies IntegrationOAuthMethodRegistration

const device = {
  integrationID: Integration.ID.make("xai"),
  method: {
    id: deviceMethodID,
    type: "oauth",
    label: "xAI Grok OAuth (Headless / Remote / VPS)",
  },
  authorize: () =>
    request(
      `${issuer}/device/code`,
      {
        method: "POST",
        headers: headers(),
        body: new URLSearchParams({ client_id: clientID, scope }).toString(),
      },
      Device,
    ).pipe(
      Effect.flatMap((value) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((created) => {
            const lifetime = positiveSeconds(value.expires_in, 0)
            return {
              mode: "auto" as const,
              url: value.verification_uri_complete ?? value.verification_uri,
              instructions: `Open ${value.verification_uri} on any device and enter code: ${value.user_code}`,
              ...(lifetime ? { expiresAt: created + lifetime * 1000 } : {}),
              callback: poll(value).pipe(Effect.flatMap((tokens) => credential(deviceMethodID, tokens))),
            }
          }),
        ),
      ),
    ),
  refresh: (value) => refresh(deviceMethodID, Credential.OAuth.make({ ...value, methodID: deviceMethodID })),
} satisfies IntegrationOAuthMethodRegistration

export const XAIPlugin = define({
  id: "opencode.provider.xai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("xai", (integration) => {
        integration.name = "xAI"
      })
      draft.method.update(browser)
      draft.method.update(device)
      draft.method.update({ integrationID: "xai", method: { type: "key", label: "Manually enter API Key" } })
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
})

function exchange(code: string, pkce: Pkce) {
  return request(
    `${issuer}/token`,
    {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectURI,
        client_id: clientID,
        code_verifier: pkce.verifier,
      }).toString(),
    },
    Token,
  )
}

function refresh(methodID: Integration.MethodID, value: Credential.OAuth) {
  return request(
    `${issuer}/token`,
    {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: value.refresh,
        client_id: clientID,
      }).toString(),
    },
    Token,
  ).pipe(Effect.flatMap((tokens) => credential(methodID, tokens, value.refresh, value.metadata)))
}

function poll(device: typeof Device.Type): Effect.Effect<Token, unknown> {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    const expires = started + positiveSeconds(device.expires_in, 300) * 1000
    const loop = (interval: number): Effect.Effect<Token, unknown> =>
      Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) >= expires) {
          return yield* Effect.fail(new Error("xAI device authorization timed out"))
        }
        const response = yield* send(`${issuer}/token`, {
          method: "POST",
          headers: headers(),
          body: new URLSearchParams({
            grant_type: deviceGrant,
            client_id: clientID,
            device_code: device.device_code,
          }).toString(),
        })
        if (response.ok) return yield* decode(response, Token)
        const error = yield* Effect.promise(() => response.text()).pipe(
          Effect.map((body) => Option.getOrUndefined(decodeDeviceError(body))),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (error?.error === "authorization_pending") {
          return yield* Effect.sleep(interval + pollingSafetyMargin).pipe(Effect.andThen(loop(interval)))
        }
        if (error?.error === "slow_down") {
          const next = interval + 5000
          return yield* Effect.sleep(next + pollingSafetyMargin).pipe(Effect.andThen(loop(next)))
        }
        if (error?.error === "access_denied" || error?.error === "authorization_denied") {
          return yield* Effect.fail(new Error("xAI device authorization was denied"))
        }
        if (error?.error === "expired_token") {
          return yield* Effect.fail(new Error("xAI device code expired - please re-run login"))
        }
        const detail = error?.error_description ?? error?.error
        return yield* Effect.fail(
          new Error(`xAI device token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`),
        )
      })
    return yield* loop(Math.max(positiveSeconds(device.interval, 5) * 1000, 1000))
  })
}

function request<S extends Schema.Decoder<unknown>>(url: string, init: RequestInit, schema: S) {
  return send(url, init).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return decode(response, schema)
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((detail) =>
          Effect.fail(new Error(`xAI request failed (${response.status})${detail ? `: ${detail}` : ""}`)),
        ),
      )
    }),
  )
}

function send(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
    catch: (cause) => cause,
  })
}

function decode<S extends Schema.Decoder<unknown>>(response: Response, schema: S) {
  return Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(schema)))
}

function credential(
  methodID: Integration.MethodID,
  tokens: Token,
  currentRefresh?: string,
  metadata?: Readonly<Record<string, unknown>>,
) {
  const refresh = tokens.refresh_token ?? currentRefresh
  if (!refresh) return Effect.fail(new Error("xAI token response is missing refresh_token"))
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID,
      refresh,
      access: tokens.access_token,
      expires: tokenExpiration(tokens),
      metadata,
    }),
  )
}

function tokenExpiration(tokens: Token) {
  if (tokens.expires_in) return Date.now() + positiveSeconds(tokens.expires_in, 3600) * 1000
  const payload = tokens.access_token.split(".")[1]
  if (!payload) return Date.now() + 3600 * 1000
  const claims = Schema.decodeUnknownOption(
    Schema.fromJsonString(Schema.Struct({ exp: Schema.optional(Schema.Number) })),
  )(Buffer.from(payload, "base64url").toString())
  const expiration = Option.getOrUndefined(claims)?.exp
  return expiration ? expiration * 1000 : Date.now() + 3600 * 1000
}

function headers() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
  }
}

function positiveSeconds(value: unknown, fallback: number) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback
}

async function generatePKCE(): Promise<Pkce> {
  const verifier = randomString(64)
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString(
    "base64url",
  )
  return { verifier, challenge }
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => chars[byte % chars.length]).join("")
}

function authorizeURL(pkce: Pkce, state: string, nonce: string) {
  return `${issuer}/authorize?${new URLSearchParams({
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
  }).toString()}`
}
