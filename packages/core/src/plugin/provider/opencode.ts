import { Duration, Effect, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@bolt-ai/plugin/v2/effect/integration"
import { define } from "@bolt-ai/plugin/v2/effect/plugin"
import type { CredentialValue } from "@bolt-ai/sdk/v2/types"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { EventV2 } from "../../event"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { ConfigProviderV1 } from "../../v1/config/provider"
import { ConfigProviderOptionsV1 } from "../../v1/config/provider-options"
import { ConfigV1 } from "../../v1/config/config"

const defaultServer = "https://bolt.ai/console"
const clientID = "bolt-cli"
const methodID = Integration.MethodID.make("device")
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
  org_id: Schema.optional(Schema.NullOr(Schema.String)),
})
const TokenPending = Schema.Struct({ error: Schema.String })
const DeviceToken = Schema.Union([Token, TokenPending])
const User = Schema.Struct({ id: Schema.String, email: Schema.String })
const Org = Schema.Struct({ id: Schema.String, name: Schema.String })
// Console's 403 when the organization enforces SSO and the user's SSO proof is missing or expired.
const SsoRequired = Schema.Struct({
  _tag: Schema.Literal("SsoRequired"),
  orgId: Schema.String,
  connectionId: Schema.String,
})
const InvalidGrant = Schema.Struct({ error: Schema.Literal("invalid_grant") })
// Console's 401 when the session behind the access token was revoked or expired.
const Unauthorized = Schema.Struct({ _tag: Schema.Literal("Unauthorized") })
const signedOutMessage = "Reconnect OpenCode Console to continue"
const ssoMessage = (organization: string | undefined) =>
  `Sign in with SSO again to use ${organization ?? "your OpenCode Console organization"}`

class SsoRequiredError extends Schema.TaggedError<SsoRequiredError>()("OpencodeConsole.SsoRequired", {
  organization: Schema.optional(Schema.String),
  url: Schema.String,
}) {
  override get message() {
    return `${ssoMessage(this.organization)}.`
  }
}

// The Console session or refresh token was revoked or expired; only a new device login recovers.
class SignedOutError extends Schema.TaggedError<SignedOutError>()("OpencodeConsole.SignedOut", {}) {
  override get message() {
    return `${signedOutMessage}.`
  }
}

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID: Integration.ID.make("bolt"),
    method: {
      id: methodID,
      type: "oauth",
      label: "Bolt Console account",
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const server = yield* normalizeServer(answer.server ?? ConsoleAccess.defaultServer)
        const device = yield* post(
          http,
          `${server}/auth/device/code`,
          { client_id: clientID, supports_org_scope: true },
          Device,
        )
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
        const response = yield* send(http, `${ConsoleAccess.server(credential)}/auth/device/token`, {
          grant_type: "refresh_token",
          refresh_token: credential.refresh,
          client_id: clientID,
        })
        if (response.status === 400) {
          const body = yield* HttpClientResponse.schemaBodyJson(InvalidGrant)(response).pipe(Effect.option)
          if (Option.isSome(body)) return yield* new SignedOutError()
        }
        const token = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
        )
        // Persist rotated tokens without depending on discovery requests.
        return {
          ...credential,
          access: token.access_token,
          refresh: token.refresh_token,
          expires: Date.now() + token.expires_in * 1000,
          metadata:
            token.org_id == null
              ? credential.metadata
              : {
                  ...credential.metadata,
                  orgID: token.org_id,
                  orgName:
                    credential.metadata?.orgID === token.org_id && typeof credential.metadata.orgName === "string"
                      ? credential.metadata.orgName
                      : token.org_id,
                },
        }
      }),
    label: (credential) => (typeof credential.metadata?.orgName === "string" ? credential.metadata.orgName : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

export const OpencodePlugin = define<HttpClient.HttpClient | EventV2.Service | Scope.Scope>({
  id: "bolt",
  effect: Effect.fn(function* (ctx) {
    const disableFree = ["1", "true"].includes(process.env.OPENCODE_DISABLE_FREE_MODELS?.toLowerCase() ?? "")
    const bus = yield* Bus.Service
    const client = yield* HttpClient.HttpClient
    // Every request here goes to the Console, which reads the User-Agent to tell which OpenCode a member runs
    // and whether it evaluates the policies it is being sent.
    const http = HttpClient.mapRequest(client, HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)))
    const managed = yield* ManagedPolicy.Service
    const config = yield* Config.Service
    const scope = yield* Scope.Scope
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let snapshot: {
      // The Console response in one of its two formats: a regular OpenCode config, merged as an integration config
      // layer, or the legacy response, which OpencodeLegacy applies directly.
      remote: { type: "config"; info: ConfigIntegration.Remote } | OpencodeLegacy.Snapshot | undefined
      connection: ActiveConnection
      organization: string | undefined
    } = { remote: undefined, connection: undefined, organization: undefined }
    // Status last reported for the active connection, so inference failures can name the fix.
    let reported: IntegrationConnection.Status | undefined
    let explainers: Effect.Success<ReturnType<typeof ctx.session.hook>>[] = []
    // When the last Console config load started, so rejected inference can reuse a recent status.
    let checked = Number.NEGATIVE_INFINITY

    const load = Effect.fn("OpencodePlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active("bolt")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      connected = connection !== undefined
      providers = credential
        ? yield* fetchProviders(http, credential).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("failed to load Bolt provider config", { cause }).pipe(Effect.as(undefined)),
            ),
          )
        : undefined
    })

    yield* ctx.integration.transform((draft) => {
      draft.update("bolt", (integration) => {
        integration.name = "Bolt"
      })
      draft.method.update(oauth(http))
      draft.method.update({ integrationID: "bolt", method: { type: "key", label: "API key (service account)" } })
    })

    connected = (yield* ctx.integration.connection.active("bolt")) !== undefined
    yield* ctx.catalog.transform((catalog) => {
      for (const [providerID, item] of Object.entries(providers ?? {})) {
        catalog.provider.update(providerID, (provider) => {
          provider.integrationID = Integration.ID.make("bolt")
          if (item.name !== undefined) provider.name = item.name
          provider.api = item.npm
            ? { type: "aisdk", package: item.npm, url: item.api }
            : { type: "native", url: item.api, settings: {} }
          Object.assign(provider.request.headers, item.options?.headers)
          Object.assign(provider.request.body, withoutCredentials(item.options))
        })

        for (const [modelID, config] of Object.entries(item.models ?? {})) {
          catalog.model.update(providerID, modelID, (model) => {
            if (config.family !== undefined) model.family = config.family
            if (config.name !== undefined) model.name = config.name
            if (config.id !== undefined) model.api.id = config.id
            if (config.provider !== undefined) {
              model.api = config.provider.npm
                ? {
                    id: model.api.id,
                    type: "aisdk",
                    package: config.provider.npm,
                    url: config.provider.api,
                  }
                : { id: model.api.id, type: "native", url: config.provider.api, settings: {} }
            }
            if (config.tool_call !== undefined) model.capabilities.tools = config.tool_call
            if (config.modalities?.input !== undefined) model.capabilities.input = [...config.modalities.input]
            if (config.modalities?.output !== undefined) model.capabilities.output = [...config.modalities.output]
            const packageName = config.provider?.npm ?? item.npm
            const lowerer = ConfigProviderOptionsV1.get(packageName)
            Object.assign(model.request.headers, config.headers)
            Object.assign(model.request.body, lowerer.request(withoutCredentials(config.options)))
            if (config.variants !== undefined) {
              model.variants = Object.entries(config.variants).map(([id, options]) => ({
                id: ModelV2.VariantID.make(id),
                headers: { ...(options.headers ?? {}) },
                body: lowerer.request(withoutCredentials(options)),
              }))
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
      const status = (status: IntegrationConnection.Status | undefined) => {
        reported = status
        return ctx.integration.connection.status({ integrationID: "opencode", connection, status })
      }
      return yield* ctx.integration.connection.resolve(connection).pipe(
        Effect.flatMap((credential) => {
          if (!credential || credential.type === "external")
            return Effect.succeed({ remote: undefined, connection, organization: undefined })
          return fetchConfig(http, credential).pipe(
            Effect.map((remote) => ({
              remote:
                remote?.type === "legacy"
                  ? OpencodeLegacy.make(remote.response, ConsoleAccess.headers(credential))
                  : remote,
              connection,
              organization: organizationName(credential),
            })),
          )
        }),
        Effect.tap(() => status(undefined)),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            // Only well-formed Console errors change the connection status; anything else may be transient.
            const next = connectionStatus(cause)
            if (next) yield* status(next)
            yield* Effect.logWarning("failed to load OpenCode provider config", { cause })
            // A load that fails for the connection already in place keeps its last config: dropping it
            // would lift organization policy while personal credentials keep working.
            return IntegrationConnection.key(connection) === IntegrationConnection.key(snapshot.connection)
              ? { remote: snapshot.remote, connection, organization: snapshot.organization }
              : { remote: undefined, connection, organization: undefined }
          }),
        ),
      )
    })
    // The Console document as config layered it. Its providers apply at this plugin's position in the provider chain,
    // where the legacy overlay applies, while the rest of the document merges through config.
    let integrated: ConfigIntegration.Document | undefined
    const integrate = Effect.fnUntraced(function* (document: ConfigIntegration.Document | undefined) {
      yield* config.integration?.(Integration.ID.make("opencode"), document) ?? Effect.void
      integrated = (yield* config.entries()).find(
        (entry): entry is ConfigIntegration.Document =>
          entry instanceof ConfigIntegration.Document && entry.integrationID === Integration.ID.make("opencode"),
      )
    })
    // Policies and providers ride on the snapshot, so a credential switch, disconnect, or 404 replaces them too.
    const publish = Effect.fnUntraced(function* (next: typeof snapshot) {
      switch (next.remote?.type) {
        // A regular config merges as one integration document, which config loads right after managed policies,
        // so its policies reach ManagedPolicy through config rather than as Console statements.
        case "config":
          yield* managed.set({ statements: [], organization: next.organization })
          return yield* integrate(
            next.connection &&
              ConfigIntegration.make({
                integrationID: Integration.ID.make("opencode"),
                connection:
                  next.connection.type === "credential"
                    ? { ...next.connection, id: Credential.ID.make(next.connection.id) }
                    : next.connection,
                organization: next.organization,
                info: next.remote.info,
              }),
          )
        case "legacy":
          yield* managed.set({ statements: OpencodeLegacy.statements(next.remote), organization: next.organization })
          return yield* integrate(undefined)
        default:
          yield* managed.set({ statements: [], organization: next.organization })
          return yield* integrate(undefined)
      }
    })
    const search = (providerID: WebSearch.ID, connection: NonNullable<ActiveConnection>) => ({
      id: providerID,
      name: "OpenCode Web Search",
      execute: (input: WebSearch.ProviderInput) =>
        Effect.gen(function* () {
          const active = yield* ctx.integration.connection.active("opencode")
          if (
            !active ||
            (connection.type === "credential"
              ? active.type !== "credential" || active.id !== connection.id
              : active.type !== "env" || active.name !== connection.name)
          ) {
            return yield* Effect.fail(new Error("OpenCode Console connection changed"))
          }
          const credential = yield* ctx.integration.connection.resolve(active)
          if (!credential || credential.type === "external")
            return yield* Effect.fail(new Error("OpenCode Console is not connected"))
          const metadata = credential.metadata
          const orgID = typeof metadata?.orgID === "string" ? metadata.orgID : undefined
          const token = credential.type === "oauth" ? credential.access : credential.key
          const server = yield* normalizeServer(ConsoleAccess.server(credential))
          const request = yield* HttpClientRequest.post(`${server}/api/websearch`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.setHeaders(orgID ? { "x-org-id": orgID } : {}),
            HttpClientRequest.schemaBodyJson(WebSearch.Input)({
              query: input.query,
              providerID,
            }),
          )
          const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
            .execute(request)
            .pipe(
              Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
              Effect.flatMap(HttpClientResponse.schemaBodyJson(WebSearch.Response)),
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: Duration.seconds(25),
                orElse: () => Effect.fail(new Error("OpenCode web search request timed out")),
              }),
            )
          if (response.providerID !== providerID) {
            return yield* Effect.fail(
              new Error(`OpenCode web search returned provider ${response.providerID} instead of ${providerID}`),
            )
          }
          return response.results
        }),
    })

      const item = catalog.provider.get(ProviderV2.ID.bolt)
      if (!item) return
      const hasKey = Boolean(process.env.BOLT_API_KEY || connected || item.provider.request.body.apiKey)
      catalog.provider.update(item.provider.id, (provider) => {
        if (!hasKey) provider.request.body.apiKey = "public"
      })
      editor.method.update(oauth(http))
      editor.method.update({ integrationID: "opencode", method: { type: "key", label: "API key (service account)" } })
    })

    snapshot = yield* load()
    yield* publish(snapshot)
    yield* OpencodeLegacy.register(ctx, () => snapshot, search)
    yield* ctx.provider.transform((providers) => {
      if (integrated) ConfigProviderPlugin.integrate(providers, integrated)
    })
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(Provider.ID.opencode)
      if (!item) return
      const hasKey = Boolean(process.env.OPENCODE_API_KEY || snapshot.connection || item.provider.settings?.apiKey)
      providers.update(item.provider.id, (provider) => {
        if (!hasKey && !disableFree) {
          provider.activation = "enabled"
          provider.settings = { ...provider.settings, apiKey: "public" }
        }
      })
    })
    yield* ctx.model.transform((models) => {
      const item = models.provider.get(Provider.ID.opencode)
      if (!item) return
      const hasKey = Boolean(
        process.env.OPENCODE_API_KEY ||
          snapshot.connection ||
          (item.provider.settings?.apiKey && item.provider.settings.apiKey !== "public"),
      )
      if (hasKey) return
      for (const model of models.list(item.provider.id)) {
        if (!model.cost.some((cost) => cost.input > 0)) continue
        models.update(item.provider.id, model.id, (draft) => {
          draft.enabled = false
        })
      }
    })
    // Like any search plugin, the Console's provider is available whenever it is connected; the Console's config
    // selects it as the default through config, where the user's own selection wins.
    yield* ctx.websearch.transform((editor) => {
      if (snapshot.remote?.type === "config" && snapshot.connection)
        editor.add(search(WebSearch.ID.make("opencode"), snapshot.connection))
    })

    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("bolt")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* poll()
  }),
})

function fetchConfig(http: HttpClient.HttpClient, value: Credential.Key | Credential.OAuth) {
  // Scoped so responses whose body is never read (404, errors) are released here instead of by a GC-time abort.
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${ConsoleAccess.server(value)}/api/v2/config`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(ConsoleAccess.headers(value)),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status === 404) return undefined
          if (response.status === 401) {
            const body = yield* HttpClientResponse.schemaBodyJson(Unauthorized)(response).pipe(Effect.option)
            if (Option.isSome(body)) return yield* new SignedOutError()
          }
          if (response.status === 403) {
            const body = yield* HttpClientResponse.schemaBodyJson(SsoRequired)(response).pipe(Effect.option)
            if (Option.isSome(body))
              return yield* new SsoRequiredError({
                organization: organizationName(value),
                url: yield* ssoUrl(ConsoleAccess.server(value), body.value.connectionId),
              })
          }
          const body = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap((ok) => ok.json))
          // A Console that serves a regular OpenCode config marks it with `$schema`; any other body is the legacy response.
          if (Predicate.hasProperty(body, "$schema"))
            return { type: "config" as const, info: yield* Schema.decodeUnknownEffect(ConfigIntegration.Remote)(body) }
          return { type: "legacy" as const, response: yield* Schema.decodeUnknownEffect(OpencodeLegacy.Response)(body) }
        }),
      ),
      Effect.scoped,
    )
}

function ssoUrl(server: string, connectionID: string) {
  return normalizeServer(server).pipe(
    Effect.map((base) => {
      // Console only redirects to paths under its own base path after SSO.
      const redirectTo = `${new URL(base).pathname.replace(/\/+$/, "")}/`
      return `${base}/auth/sso/${encodeURIComponent(connectionID)}/start?redirectTo=${encodeURIComponent(redirectTo)}`
    }),
  )
}

function connectionStatus(cause: unknown): IntegrationConnection.Status | undefined {
  if (cause instanceof SsoRequiredError)
    return {
      status: "needs_auth",
      message: ssoMessage(cause.organization),
      url: cause.url,
    }
  if (
    cause instanceof SignedOutError ||
    (cause instanceof Integration.AuthorizationError && cause.cause instanceof SignedOutError)
  )
    return { status: "needs_auth", message: signedOutMessage }
  return undefined
}

function organizationName(credential: Credential.Value) {
  return typeof credential.metadata?.orgName === "string" ? credential.metadata.orgName : undefined
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
    const org =
      token.org_id == null
        ? orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
        : orgs.find((org) => org.id === token.org_id)
    if (token.org_id != null && !org) {
      return yield* Effect.fail(new Error(`OpenCode organization not found: ${token.org_id}`))
    }
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
  body: Record<string, string | boolean>,
  schema: S,
  statusOk = true,
) {
  return send(http, url, body).pipe(
    Effect.flatMap((response) => (statusOk ? HttpClientResponse.filterStatusOk(response) : Effect.succeed(response))),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  )
}

function send(http: HttpClient.HttpClient, url: string, body: Record<string, string | boolean>) {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.schemaBodyJson(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])))(body),
    Effect.flatMap((request) => http.execute(request)),
  )
}
