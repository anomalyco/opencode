import { Duration, Effect, Schema, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import type { CredentialValue } from "@opencode-ai/sdk/v2/types"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { EventV2 } from "../../event"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ModelRequest } from "../../model-request"
import { ProviderV2 } from "../../provider"

const defaultServer = "https://console.opencode.ai"
const clientID = "opencode-cli"
const methodID = Integration.MethodID.make("device")
const RemoteRequest = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  body: Schema.Record(Schema.String, Schema.Any).pipe(Schema.optional),
})
const RemoteModelApi = Schema.Union([
  Schema.Struct({ id: ModelV2.ID.pipe(Schema.optional), ...ProviderV2.AISDK.fields }),
  Schema.Struct({ id: ModelV2.ID.pipe(Schema.optional), ...ProviderV2.Native.fields }),
  Schema.Struct({ id: ModelV2.ID }),
])
const RemoteCost = Schema.Struct({
  tier: Schema.Struct({ type: Schema.Literal("context"), size: Schema.Int }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite.pipe(Schema.optional),
    write: Schema.Finite.pipe(Schema.optional),
  }).pipe(Schema.optional),
})
const RemoteModel = Schema.Struct({
  family: ModelV2.Family.pipe(Schema.optional),
  name: Schema.String.pipe(Schema.optional),
  api: RemoteModelApi.pipe(Schema.optional),
  capabilities: ModelV2.Capabilities.pipe(Schema.optional),
  request: Schema.Struct({ ...RemoteRequest.fields, variant: Schema.String.pipe(Schema.optional) }).pipe(
    Schema.optional,
  ),
  variants: Schema.Struct({
    id: ModelV2.VariantID,
    ...RemoteRequest.fields,
  }).pipe(Schema.Array, Schema.optional),
  cost: Schema.Union([RemoteCost, Schema.Array(RemoteCost)]).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  limit: Schema.Struct({
    context: Schema.Int.pipe(Schema.optional),
    input: Schema.Int.pipe(Schema.optional),
    output: Schema.Int.pipe(Schema.optional),
  }).pipe(Schema.optional),
})
const RemoteProvider = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  api: ProviderV2.Api.pipe(Schema.optional),
  request: RemoteRequest.pipe(Schema.optional),
  models: Schema.Record(Schema.String, RemoteModel).pipe(Schema.optional),
})
const RemoteConfig = Schema.Struct({
  providers: Schema.Record(Schema.String, RemoteProvider),
})
const RemoteResponse = Schema.Struct({ config: RemoteConfig })
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
    authorize: () =>
      Effect.gen(function* () {
        const device = yield* post(http, `${defaultServer}/auth/device/code`, { client_id: clientID }, Device)
        return {
          mode: "auto" as const,
          url: `${defaultServer}${device.verification_uri_complete}`,
          instructions: `Enter code: ${device.user_code}`,
          callback: poll(http, defaultServer, device.device_code, Duration.seconds(device.interval)),
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
    label: (credential) => {
      return typeof credential.metadata?.orgName === "string" ? credential.metadata.orgName : undefined
    },
  } satisfies IntegrationOAuthMethodRegistration
}

export const OpencodePlugin = define<HttpClient.HttpClient | EventV2.Service | Scope.Scope>({
  id: "opencode",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const http = yield* HttpClient.HttpClient
    let connected = false
    let providers: typeof RemoteConfig.Type.providers | undefined

    const load = Effect.fn("OpencodePlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("opencode")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      connected = connection !== undefined
      providers = credential
        ? yield* fetchProviders(http, credential).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("failed to load OpenCode provider config", { cause }).pipe(Effect.as(undefined)),
            ),
          )
        : undefined
    })

    yield* ctx.integration.transform((draft) => {
      draft.update("opencode", (integration) => {
        integration.name = "OpenCode"
      })
      draft.method.update(oauth(http))
      draft.method.update({ integrationID: "opencode", method: { type: "key", label: "API key (service account)" } })
    })

    yield* load()
    yield* ctx.catalog.transform((catalog) => {
      for (const [providerID, item] of Object.entries(providers ?? {})) {
        catalog.provider.update(providerID, (provider) => {
          if (item.name !== undefined) provider.name = item.name
          if (item.api !== undefined) provider.api = { ...item.api }
          if (item.request !== undefined) {
            Object.assign(provider.request.headers, item.request.headers)
            Object.assign(provider.request.body, item.request.body)
          }
        })
        const providerApi = catalog.provider.get(providerID)?.provider.api
        const providerPackage = providerApi?.type === "aisdk" ? providerApi.package : undefined

        for (const [modelID, config] of Object.entries(item.models ?? {})) {
          catalog.model.update(providerID, modelID, (model) => {
            if (config.family !== undefined) model.family = config.family
            if (config.name !== undefined) model.name = config.name
            if (config.api !== undefined) model.api = { ...model.api, ...config.api }
            const packageName = model.api.type === "aisdk" ? model.api.package : providerPackage
            if (config.capabilities !== undefined) {
              model.capabilities = {
                tools: config.capabilities.tools,
                input: [...config.capabilities.input],
                output: [...config.capabilities.output],
              }
            }
            if (config.request !== undefined) {
              ModelRequest.assign(model.request, {
                headers: config.request.headers,
                ...ModelRequest.normalizeAiSdkOptions(packageName, config.request.body ?? {}),
              })
              if (config.request.variant !== undefined) model.request.variant = config.request.variant
            }
            if (config.variants !== undefined) {
              for (const variant of config.variants) {
                let existing = model.variants.find((item) => item.id === variant.id)
                if (!existing) {
                  existing = { id: variant.id, headers: {}, body: {}, generation: {}, options: {} }
                  model.variants.push(existing)
                }
                ModelRequest.assign(existing, {
                  headers: variant.headers,
                  ...ModelRequest.normalizeAiSdkOptions(packageName, variant.body ?? {}),
                })
              }
            }
            if (config.cost !== undefined) {
              model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                tier: cost.tier && { ...cost.tier },
                input: cost.input,
                output: cost.output,
                cache: { read: cost.cache?.read ?? 0, write: cost.cache?.write ?? 0 },
              }))
            }
            if (config.disabled !== undefined) model.enabled = !config.disabled
            if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
          })
        }
      }

      const item = catalog.provider.get(ProviderV2.ID.opencode)
      if (!item) return
      const hasKey = Boolean(process.env.OPENCODE_API_KEY || connected || item.provider.request.body.apiKey)
      catalog.provider.update(item.provider.id, (provider) => {
        if (!hasKey) provider.request.body.apiKey = "public"
      })
      if (hasKey) return
      for (const model of item.models.values()) {
        if (!model.cost.some((cost) => cost.input > 0)) continue
        catalog.model.update(item.provider.id, model.id, (draft) => {
          draft.enabled = false
        })
      }
    })

    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("opencode")),
      Stream.runForEach(() => load().pipe(Effect.andThen(ctx.catalog.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function fetchProviders(http: HttpClient.HttpClient, value: CredentialValue) {
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
        if (response.status === 404) return Effect.succeed(undefined)
        return HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RemoteResponse)),
          Effect.map((remote) => remote.config.providers),
        )
      }),
    )
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
    return new Credential.OAuth({
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
