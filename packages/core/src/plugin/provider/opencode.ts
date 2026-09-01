import { Cause, Duration, Effect, Exit, Latch, Option, Schedule, Schema, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { ConfigProviderV1 } from "../../v1/config/provider.js"
import { Money } from "@opencode-ai/schema/money"
import { ConfigProviderOptionsV1 } from "../../v1/config/provider-options.js"
import { ConfigV1 } from "../../v1/config/config.js"
import { isDeepStrictEqual } from "node:util"

const defaultServer = "https://opencode.ai/console"
const clientID = "opencode-cli"
const methodID = Integration.MethodID.make("device")
const RemoteResponse = Schema.Struct({ config: ConfigV1.Info })
const CachedInventory = Schema.fromJsonString(
  Schema.Record(Schema.String, ConfigProviderV1.Info).check(
    Schema.makeFilter((providers) =>
      Object.values(providers).every(
        (provider) =>
          cacheableURL(provider.api) &&
          cacheable(provider.options) &&
          Object.values(provider.models ?? {}).every(
            (model) =>
              cacheableURL(model.provider?.api) &&
              cacheable(model.options) &&
              cacheable({ headers: model.headers }) &&
              Object.values(model.variants ?? {}).every(cacheable),
          ),
      ),
    ),
  ),
)
const placeholder = /^(?:Bearer )?\{env:[a-z_][a-z_0-9]*\}$/i
const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri_complete: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
})
const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
})
const TokenPending = Schema.Struct({ error: Schema.String })
const DeviceToken = Schema.Union([Token, TokenPending])
const User = Schema.Struct({ id: Schema.String, email: Schema.String })
const Org = Schema.Struct({ id: Schema.String, name: Schema.String })

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID: Integration.ID.make("opencode"),
    method: {
      id: methodID,
      type: "oauth",
      label: "OpenCode Console account",
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const server = yield* normalizeServer(answer.server ?? defaultServer)
        const device = yield* post(http, `${server}/auth/device/code`, { client_id: clientID }, Device)
        const verification = yield* Effect.try({
          try: () => {
            const url = new URL(device.verification_uri_complete, `${server}/`)
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S)")
            return url
          },
          catch: (cause) =>
            new Error(`Invalid device verification URL: ${cause instanceof Error ? cause.message : String(cause)}`),
        })
        return {
          mode: "auto" as const,
          url: verification.href,
          instructions: `Enter code: ${device.user_code}`,
          callback: poll(http, server, device.device_code, Duration.seconds(device.interval)),
        }
      }),
    refresh: (credential) =>
      Effect.gen(function* () {
        const server = typeof credential.metadata?.server === "string" ? credential.metadata.server : defaultServer
        const token = yield* post(
          http,
          `${server}/auth/device/token`,
          { grant_type: "refresh_token", refresh_token: credential.refresh, client_id: clientID },
          Token,
        )
        return {
          ...credential,
          access: token.access_token,
          refresh: token.refresh_token,
          expires: Date.now() + token.expires_in * 1000,
        }
      }),
    label: (credential) => (typeof credential.metadata?.orgName === "string" ? credential.metadata.orgName : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

export const OpencodePlugin = define<HttpClient.HttpClient | Bus.Service | Scope.Scope>({
  id: "opencode.provider.opencode",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      draft.update("opencode", (integration) => {
        integration.name = "OpenCode"
      })
      draft.method.update(oauth(http))
      draft.method.update({ integrationID: "opencode", method: { type: "key", label: "API key (service account)" } })
    })

    const read = Effect.fn("OpencodePlugin.readCache")(function* () {
      const connection = yield* ctx.integration.connection.active("opencode")
      // Stored connection IDs survive token refresh and separate accounts, servers, and organizations.
      const cached =
        connection?.type === "credential"
          ? yield* ctx.storage
              .get(`inventory:${connection.id}`)
              .pipe(
                Effect.catchDefect((cause) =>
                  Effect.logWarning("failed to read Console inventory cache", { cause }).pipe(Effect.as(undefined)),
                ),
              )
          : undefined
      return { connection, providers: Option.getOrUndefined(Schema.decodeUnknownOption(CachedInventory)(cached)) }
    })
    let inventory = yield* read()
    const ready = yield* Latch.make()

    const refresh = Effect.fn("OpencodePlugin.refresh")(function* () {
      // Activation batches transforms; materialize OAuth refresh before resolution, but not before cache restore.
      if (inventory.connection?.type === "credential") {
        const registered = yield* ctx.integration
          .get({ integrationID: Integration.ID.make("opencode") })
          .pipe(Effect.orElseSucceed(() => undefined))
        if (!registered?.data?.methods.some((method) => method.type === "oauth" && method.id === methodID))
          yield* ctx.integration.reload()
      }
      const providers = inventory.connection
        ? yield* ctx.integration.connection.resolve(inventory.connection).pipe(
            Effect.flatMap((credential) =>
              credential
                ? fetchProviders(http, credential).pipe(Effect.map((providers) => providers ?? {}))
                : Effect.undefined,
            ),
            Effect.retry({ while: retryable, times: 2, schedule: Schedule.exponential(200) }),
            Effect.timeout("5 seconds"),
          )
        : undefined
      if (isDeepStrictEqual(inventory.providers, providers)) return
      inventory = { connection: inventory.connection, providers }
      yield* ctx.catalog.reload()
      if (inventory.connection?.type !== "credential" || providers === undefined) return
      const cached = Schema.encodeOption(CachedInventory)(providers)
      yield* (
        Option.isSome(cached)
          ? ctx.storage.set(`inventory:${inventory.connection.id}`, cached.value)
          : ctx.storage.remove(`inventory:${inventory.connection.id}`)
      ).pipe(Effect.catchDefect((cause) => Effect.logWarning("failed to persist Console inventory cache", { cause })))
    })

    yield* ctx.catalog.transform((catalog) => {
      // Later transforms may mutate nested settings; keep the source inventory independent of catalog policy.
      for (const [providerID, item] of Object.entries(structuredClone(inventory.providers ?? {}))) {
        catalog.provider.update(providerID, (provider) => {
          provider.integrationID = Integration.ID.make("opencode")
          if (item.name !== undefined) provider.name = item.name
          provider.package = item.npm ? Provider.aisdk(item.npm) : ""
          provider.settings = {
            ...provider.settings,
            ...withoutCredentials(item.options),
            ...(item.api ? { baseURL: item.api } : {}),
          }
          provider.headers = { ...provider.headers, ...item.options?.headers }
        })

        for (const [modelID, config] of Object.entries(item.models ?? {})) {
          catalog.model.update(providerID, modelID, (model) => {
            if (config.family !== undefined) model.family = Model.Family.make(config.family)
            if (config.name !== undefined) model.name = config.name
            if (config.id !== undefined) model.modelID = Model.ID.make(config.id)
            model.compatibility = Model.compatibility(config.interleaved) ?? model.compatibility
            if (config.provider !== undefined) {
              model.package = config.provider.npm ? Provider.aisdk(config.provider.npm) : undefined
              if (config.provider.api) model.settings = { ...model.settings, baseURL: config.provider.api }
            }
            if (config.tool_call !== undefined) model.capabilities.tools = config.tool_call
            if (config.modalities?.input !== undefined) model.capabilities.input = [...config.modalities.input]
            if (config.modalities?.output !== undefined) model.capabilities.output = [...config.modalities.output]
            model.headers = { ...model.headers, ...config.headers }
            model.settings = { ...model.settings, ...ConfigProviderOptionsV1.model(withoutCredentials(config.options)) }
            if (config.variants !== undefined) {
              model.variants ??= []
              for (const [id, options] of Object.entries(config.variants)) {
                const variantID = Model.VariantID.make(id)
                let existing = model.variants.find((item) => item.id === variantID)
                if (!existing) {
                  existing = { id: variantID }
                  model.variants.push(existing)
                }
                existing.headers = { ...existing.headers, ...options.headers }
                existing.settings = {
                  ...existing.settings,
                  ...ConfigProviderOptionsV1.model(withoutCredentials(options)),
                }
              }
            }
            if (config.release_date !== undefined) {
              const released = Date.parse(config.release_date)
              model.time.released = Number.isFinite(released) ? released : 0
            }
            if (config.cost !== undefined) {
              model.cost = remoteCost(config.cost)
            }
            model.status = config.status ?? "active"
            model.enabled = config.status !== "deprecated"
            if (config.limit !== undefined) model.limit = { ...config.limit }
          })
        }
      }

      const item = catalog.provider.get(Provider.ID.opencode)
      if (!item) return
      const hasKey = Boolean(process.env.OPENCODE_API_KEY || inventory.connection || item.provider.settings?.apiKey)
      catalog.provider.update(item.provider.id, (provider) => {
        if (!hasKey) {
          provider.activation = "enabled"
          provider.settings = { ...provider.settings, apiKey: "public" }
        }
      })
      if (hasKey) return
      for (const model of item.models.values()) {
        if (!model.cost.some((cost) => cost.input > 0)) continue
        catalog.model.update(item.provider.id, model.id, (draft) => {
          draft.enabled = false
        })
      }
    })

    // Switching waits for the previous refresh to stop, so only one worker writes the captured inventory.
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("opencode")),
      Stream.prepend([undefined]),
      Stream.switchMap((event) =>
        Stream.fromEffect(
          Effect.gen(function* () {
            if (event) {
              inventory = yield* read()
              yield* ctx.catalog.reload()
            }
            if (inventory.providers !== undefined) yield* ready.open
            yield* refresh().pipe(
              Effect.tapError((cause) => Effect.logWarning("failed to load OpenCode provider config", { cause })),
              Effect.onExit((exit) =>
                Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) ? Effect.void : ready.open,
              ),
              Effect.retry({
                while: retryable,
                schedule: Schedule.min([Schedule.exponential("5 seconds"), Schedule.spaced("30 seconds")]),
              }),
              Effect.ignore,
            )
          }),
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ready.await
  }),
})

function cacheable(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(cacheable)
  if (value === null || typeof value !== "object") return true
  return Object.entries(value).every(([key, item]) => {
    const name = key.replace(/[-_]/g, "").toLowerCase()
    if (name === "headers") {
      if (item === undefined) return true
      if (item === null || typeof item !== "object" || Array.isArray(item)) return false
      return Object.entries(item).every(
        ([header, content]) =>
          typeof content === "string" &&
          (placeholder.test(content) ||
            [
              "x-org-id",
              "anthropic-version",
              "anthropic-beta",
              "content-type",
              "accept",
              "openai-organization",
              "openai-project",
            ].includes(header.toLowerCase())),
      )
    }
    if (
      /^(?:apiKey|xApiKey|xGoogApiKey|authorization|accessToken|authToken|refreshToken|password|secret|credentials|cookie|setCookie)$/i.test(
        name,
      )
    )
      return typeof item === "string" && placeholder.test(item)
    if (name === "baseurl" || name === "enterpriseurl") return typeof item === "string" && cacheableURL(item)
    return cacheable(item)
  })
}

function cacheableURL(value: string | undefined) {
  if (value === undefined) return true
  const url = URL.parse(value)
  return url !== null && !url.username && !url.password && !url.search && !url.hash
}

function retryable(cause: unknown): boolean {
  if (cause instanceof Integration.AuthorizationError) return retryable(cause.cause)
  if (Cause.isTimeoutError(cause)) return true
  if (!HttpClientError.isHttpClientError(cause)) return false
  return (
    cause.reason._tag === "TransportError" ||
    (cause.reason._tag === "StatusCodeError" &&
      (cause.reason.response.status === 408 ||
        cause.reason.response.status === 429 ||
        cause.reason.response.status >= 500))
  )
}

function fetchProviders(http: HttpClient.HttpClient, value: Credential.Value) {
  const metadata = value.metadata
  const server = typeof metadata?.server === "string" ? metadata.server : defaultServer
  const orgID = typeof metadata?.orgID === "string" ? metadata.orgID : undefined
  const token = value.type === "oauth" ? value.access : value.key
  return http
    .execute(
      HttpClientRequest.get(`${server}/api/config`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeaders(orgID ? { "x-org-id": orgID } : {}),
      ),
    )
    .pipe(
      Effect.flatMap((response) => {
        if (response.status === 404) return Effect.undefined
        return HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RemoteResponse)),
          Effect.map((remote) => remote.config.provider),
        )
      }),
    )
}

function withoutCredentials(body: Readonly<Record<string, unknown>> | undefined) {
  return Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => key !== "apiKey" && key !== "headers"))
}

function normalizeServer(input: unknown) {
  return Effect.try({
    try: () => {
      if (typeof input !== "string") throw new Error("expected string")
      const url = new URL(input)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S)")
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
    },
    catch: (cause) =>
      new Error(`Invalid OpenCode server URL: ${cause instanceof Error ? cause.message : String(cause)}`),
  })
}

function remoteCost(input: NonNullable<(typeof ConfigProviderV1.Model.Type)["cost"]>) {
  const base = {
    input: Money.USDPerMillionTokens.make(input.input),
    output: Money.USDPerMillionTokens.make(input.output),
    cache: {
      read: Money.USDPerMillionTokens.make(input.cache_read ?? 0),
      write: Money.USDPerMillionTokens.make(input.cache_write ?? 0),
    },
  }
  if (!input.context_over_200k) return [base]
  return [
    base,
    {
      tier: { type: "context" as const, size: 200_000 },
      input: Money.USDPerMillionTokens.make(input.context_over_200k.input),
      output: Money.USDPerMillionTokens.make(input.context_over_200k.output),
      cache: {
        read: Money.USDPerMillionTokens.make(input.context_over_200k.cache_read ?? 0),
        write: Money.USDPerMillionTokens.make(input.context_over_200k.cache_write ?? 0),
      },
    },
  ]
}

function poll(http: HttpClient.HttpClient, server: string, deviceCode: string, interval: Duration.Duration) {
  const loop = (wait: Duration.Duration): Effect.Effect<Credential.OAuth, unknown> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* post(
        http,
        `${server}/auth/device/token`,
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientID,
        },
        DeviceToken,
        false,
      )
      if ("access_token" in result) return yield* credential(http, server, result)
      if (result.error === "authorization_pending") return yield* loop(wait)
      if (result.error === "slow_down") {
        return yield* loop(Duration.sum(wait, Duration.seconds(5)))
      }
      return yield* Effect.fail(new Error(`Device authorization failed: ${result.error}`))
    })
  return loop(interval)
}

function credential(http: HttpClient.HttpClient, server: string, token: typeof Token.Type) {
  return Effect.gen(function* () {
    const [user, orgs] = yield* Effect.all(
      [
        get(http, `${server}/api/user`, token.access_token, User),
        get(http, `${server}/api/orgs`, token.access_token, Schema.Array(Org)),
      ],
      { concurrency: 2 },
    )
    const org = orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
    return Credential.OAuth.make({
      type: "oauth" as const,
      methodID,
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000,
      metadata: {
        server,
        accountID: user.id,
        email: user.email,
        orgID: org?.id,
        orgName: org?.name,
      },
    })
  })
}

function get<S extends Schema.Top>(http: HttpClient.HttpClient, url: string, token: string, schema: S) {
  return HttpClient.filterStatusOk(http)
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(token)))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
}

function post<S extends Schema.Top>(
  http: HttpClient.HttpClient,
  url: string,
  body: Record<string, string>,
  schema: S,
  statusOk = true,
) {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.schemaBodyJson(Schema.Record(Schema.String, Schema.String))(body),
    Effect.flatMap((request) => http.execute(request)),
    Effect.flatMap((response) => (statusOk ? HttpClientResponse.filterStatusOk(response) : Effect.succeed(response))),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  )
}
