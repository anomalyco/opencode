import { arch, hostname, platform, release } from "node:os"
import path from "node:path"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Clock, Effect, Option, Schema, Semaphore, Stream } from "effect"
import { Global } from "@opencode-ai/util/global"
import { App } from "../../app"
import { Credential } from "../../credential"
import { EventV2 } from "../../event"
import { Integration } from "../../integration"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

const clientID = "17e5f671-d194-4dfb-9706-5516cb48c098"
const issuer = "https://auth.kimi.com"
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code"
const pollingSafetyMargin = 3000
const methodID = Integration.MethodID.make("device")
const providerID = ProviderV2.ID.make("kimi-for-coding")

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.optional(Schema.String),
  verification_uri_complete: Schema.String,
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
})

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})
type Token = typeof Token.Type

const TokenError = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
})
const decodeTokenError = Schema.decodeUnknownOption(Schema.fromJsonString(TokenError))

const oauth = (headers: Record<string, string>) =>
  ({
    integrationID: Integration.ID.make("kimi-for-coding"),
    method: {
      id: methodID,
      type: "oauth",
      label: "Kimi Code subscription (OAuth)",
    },
    authorize: () =>
      request(
        `${issuer}/api/oauth/device_authorization`,
        {
          method: "POST",
          headers: formHeaders(headers),
          body: new URLSearchParams({ client_id: clientID }).toString(),
        },
        Device,
      ).pipe(
        Effect.flatMap((device) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((created) => {
              const lifetime = positiveSeconds(device.expires_in, 0)
              return {
                mode: "auto" as const,
                url: device.verification_uri_complete,
                instructions: device.verification_uri
                  ? `Open ${device.verification_uri} on any device and enter code: ${device.user_code}`
                  : `Enter code: ${device.user_code}`,
                ...(lifetime ? { expiresAt: created + lifetime * 1000 } : {}),
                callback: poll(device, headers).pipe(Effect.map(credential)),
              }
            }),
          ),
        ),
      ),
    refresh: (value) => refresh(Credential.OAuth.make({ ...value, methodID }), headers),
  }) satisfies IntegrationOAuthMethodRegistration

export const KimiForCodingPlugin = define({
  id: "opencode.provider.kimi-for-coding",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const loading = Semaphore.makeUnsafe(1)
    const headers = identityHeaders(ctx.app, yield* deviceID())
    let connected = false

    const load = Effect.fn("KimiForCodingPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("kimi-for-coding")
      const value = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      connected = value?.type === "oauth" && value.methodID === methodID
    })

    yield* ctx.integration.transform((draft) => {
      draft.method.update(oauth(headers))
    })
    yield* load()
    yield* ctx.catalog.transform((evt) => {
      if (!connected) return
      const item = evt.provider.get(providerID)
      if (!item) return
      evt.provider.update(providerID, (provider) => {
        // Kimi's OAuth token is a bearer credential on the managed OpenAI-compatible API.
        // The API-key connection remains on the catalog's Anthropic transport.
        provider.package = ProviderV2.aisdk("@ai-sdk/openai-compatible")
        provider.headers = ProviderV2.mergeHeaders(provider.headers, headers)
      })
    })

    const reload = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("kimi-for-coding")),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function poll(device: typeof Device.Type, headers: Record<string, string>): Effect.Effect<Token, unknown> {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis
    const expires = started + positiveSeconds(device.expires_in, 300) * 1000
    const loop = (interval: number): Effect.Effect<Token, unknown> =>
      Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) >= expires) {
          return yield* Effect.fail(new Error("Kimi Code device authorization timed out"))
        }
        const response = yield* send(`${issuer}/api/oauth/token`, {
          method: "POST",
          headers: formHeaders(headers),
          body: new URLSearchParams({
            client_id: clientID,
            device_code: device.device_code,
            grant_type: deviceGrant,
          }).toString(),
        })
        if (response.ok) return yield* decode(response, Token)
        const error = yield* Effect.promise(() => response.text()).pipe(
          Effect.map((body) => Option.getOrUndefined(decodeTokenError(body))),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (error?.error === "authorization_pending") {
          return yield* Effect.sleep(interval + pollingSafetyMargin).pipe(Effect.andThen(loop(interval)))
        }
        if (error?.error === "slow_down") {
          const next = interval + 5000
          return yield* Effect.sleep(next + pollingSafetyMargin).pipe(Effect.andThen(loop(next)))
        }
        if (error?.error === "expired_token") {
          return yield* Effect.fail(new Error("Kimi Code device code expired - please re-run login"))
        }
        if (error?.error === "access_denied") {
          return yield* Effect.fail(new Error("Kimi Code device authorization was denied"))
        }
        const detail = error?.error_description ?? error?.error
        return yield* Effect.fail(
          new Error(`Kimi Code token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`),
        )
      })
    return yield* loop(Math.max(positiveSeconds(device.interval, 5) * 1000, 1000))
  })
}

function refresh(value: Credential.OAuth, headers: Record<string, string>) {
  return request(
    `${issuer}/api/oauth/token`,
    {
      method: "POST",
      headers: formHeaders(headers),
      body: new URLSearchParams({
        client_id: clientID,
        grant_type: "refresh_token",
        refresh_token: value.refresh,
      }).toString(),
    },
    Token,
  ).pipe(Effect.map((token) => credential(token, value.metadata)))
}

function credential(token: Token, metadata?: Readonly<Record<string, unknown>>) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + positiveSeconds(token.expires_in, 3600) * 1000,
    metadata,
  })
}

function request<S extends Schema.Decoder<unknown>>(url: string, init: RequestInit, schema: S) {
  return send(url, init).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return decode(response, schema)
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((detail) =>
          Effect.fail(new Error(`Kimi Code request failed (${response.status})${detail ? `: ${detail}` : ""}`)),
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

function identityHeaders(app: App.Info, id: string) {
  return {
    "User-Agent": `opencode/${app.version}`,
    "X-Msh-Platform": "kimi_code_cli",
    "X-Msh-Version": app.version,
    "X-Msh-Device-Name": ascii(hostname()),
    "X-Msh-Device-Model": ascii(`${platform()} ${release()} ${arch()}`),
    "X-Msh-Os-Version": ascii(release()),
    "X-Msh-Device-Id": id,
  }
}

function deviceID() {
  return Effect.gen(function* () {
    const file = Bun.file(path.join(Global.Path.data, "kimi-code-device-id"))
    if (yield* Effect.promise(() => file.exists())) {
      const value = (yield* Effect.promise(() => file.text())).trim()
      if (value) return value
    }
    const id = crypto.randomUUID()
    yield* Effect.promise(() => Bun.write(file, id, { mode: 0o600 }))
    return id
  })
}

function formHeaders(headers: Record<string, string>) {
  return { ...headers, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }
}

function ascii(value: string) {
  return value.replaceAll(/[^\u0020-\u007E]/g, "").trim() || "unknown"
}

function positiveSeconds(value: unknown, fallback: number) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback
}
