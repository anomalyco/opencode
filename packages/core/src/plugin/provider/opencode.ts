import { isDeepStrictEqual } from "node:util"
import { Duration, Effect, Equal, FiberHandle, Option, Schema, Scope, Semaphore, Stream } from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHttpResponse } from "@opencode/plugin/effect/session"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
} from "effect/http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { ConfigIntegration } from "../../config/integration.js"
import { ConfigProviderPlugin } from "../../config/plugin/provider.js"
import { SkillFile } from "../../config/plugin/skill-file.js"
import { ConsoleAccess } from "../../console-access.js"
import { Credential } from "../../credential.js"
import { InstructionDiscovery } from "../../instruction-discovery.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Provider } from "../../provider.js"
import { AbsolutePath } from "../../schema.js"
import { SharedCache } from "../../shared-cache.js"
import { Skill } from "../../skill.js"
import { SkillDiscovery } from "../../skill/discovery.js"
import { WebSearch } from "../../websearch.js"
import { OpencodeWatches } from "./opencode-watches.js"
import { ProviderRefresh } from "./refresh.js"

const clientID = "opencode-cli"
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
// The workspace's instructions arrive whole, its skills as versions whose files download separately.
const ConsoleInstructions = Schema.Struct({
  instructions: Schema.Array(Schema.Struct({ id: Schema.String, content: Schema.String })),
})
const ConsoleSkills = Schema.Struct({
  skills: Schema.Array(Schema.Struct({ slug: Schema.String, version: Schema.String })),
})
const SkillBundle = Schema.Struct({
  slug: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
})
type ConsoleSkill = { readonly skill: Skill.Info; readonly files: Record<string, string> }
type ConsoleConfig = NonNullable<Effect.Success<ReturnType<typeof fetchConfig>>> & {
  readonly instructions: (typeof ConsoleInstructions.Type)["instructions"]
  readonly skills: (typeof ConsoleSkills.Type)["skills"]
}
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
    integrationID: Integration.ID.make("opencode"),
    method: {
      id: methodID,
      type: "oauth",
      label: "OpenCode Console account",
      form: [
        {
          key: "server",
          type: "string",
          format: "uri",
          hidden: true,
          default: ConsoleAccess.defaultServer,
        },
      ],
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

export const OpencodePlugin = define<
  | HttpClient.HttpClient
  | Bus.Service
  | Config.Service
  | InstructionDiscovery.Service
  | SharedCache.Service
  | Skill.Service
  | Scope.Scope
>({
  id: "opencode.provider.opencode",
  effect: Effect.fn(function* (ctx) {
    const disableFree = ["1", "true"].includes(process.env.OPENCODE_DISABLE_FREE_MODELS?.toLowerCase() ?? "")
    const client = yield* HttpClient.HttpClient
    // Every request here goes to the Console, which reads the User-Agent to tell which OpenCode a member runs
    // and whether it evaluates the policies it is being sent.
    const http = HttpClient.mapRequest(client, HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)))
    const config = yield* Config.Service
    const discovery = yield* InstructionDiscovery.Service
    const skills = yield* Skill.Service
    const cache = yield* SharedCache.Service
    const scope = yield* Scope.Scope
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let snapshot: {
      // The Console's regular OpenCode config, merged as an integration config layer.
      remote: ConsoleConfig | undefined
      connection: ActiveConnection
      organization: string | undefined
    } = { remote: undefined, connection: undefined, organization: undefined }
    let instructions: InstructionDiscovery.File[] = []
    // Tagged with the account and workspace they were downloaded for, so a switch hides them right away.
    let consoleSkills: { owner: string; items: ConsoleSkill[] } = { owner: "", items: [] }
    const owner = (from: typeof snapshot) =>
      `${IntegrationConnection.key(from.connection) ?? ""}:${from.organization ?? ""}`
    // A newer config's skill download replaces one still in flight.
    const skillDownload = yield* FiberHandle.make<void, never>()
    // Status last reported for the active connection, so inference failures can name the fix.
    let reported: IntegrationConnection.Status | undefined
    let explainers: Effect.Success<ReturnType<typeof ctx.session.hook>>[] = []
    const watches = yield* OpencodeWatches.make(ctx, http)

    // Every project signed in to the same workspace shares one fetch, reused while it is younger than `maxAge`.
    const load = Effect.fn("OpencodePlugin.load")(function* (maxAge: Duration.Input = Duration.minutes(1)) {
      const connection = yield* ctx.integration.connection.active("opencode")
      if (!connection) {
        reported = undefined
        return { remote: undefined, connection, organization: undefined }
      }
      const status = (status: IntegrationConnection.Status | undefined) => {
        reported = status
        return ctx.integration.connection.status({ integrationID: "opencode", connection, status })
      }
      return yield* ctx.integration.connection.resolve(connection).pipe(
        Effect.flatMap((credential) => {
          if (!credential || credential.type === "external")
            return Effect.succeed({ remote: undefined, connection, organization: undefined })
          const workspace = workspaceKey(connection, credential)
          // Each list has its own cache entry, so a failing or malformed one keeps its last copy, or none, and never
          // holds back the config and its policies. `SharedCache` already logs the failure.
          const list = <A>(name: string, load: Effect.Effect<ReadonlyArray<A>, unknown>) =>
            cache
              .get({ key: `opencode-console-${name}:${workspace}`, interval: maxAge, load })
              .pipe(Effect.orElseSucceed((): ReadonlyArray<A> => []))
          return cache
            .get({
              key: `opencode-console:${workspace}`,
              interval: maxAge,
              // A sign-in error is Console's answer for this sign-in, so it is shared like a config rather than
              // replaced by the last config, as a network failure is.
              load: fetchConfig(http, credential).pipe(
                Effect.map((remote) => ({ remote })),
                Effect.catch((cause) =>
                  connectionStatus(cause) ? Effect.succeed({ failed: cause }) : Effect.fail(cause),
                ),
              ),
            })
            .pipe(
              Effect.flatMap((result) =>
                "failed" in result ? Effect.fail(result.failed) : Effect.succeed(result.remote),
              ),
              Effect.flatMap((remote) =>
                remote
                  ? Effect.all(
                      {
                        instructions: list(
                          "instructions",
                          fetchList(http, credential, "/api/v2/instructions", ConsoleInstructions).pipe(
                            Effect.map((body) => body?.instructions ?? []),
                          ),
                        ),
                        skills: list(
                          "skills",
                          fetchList(http, credential, "/api/v2/skills", ConsoleSkills).pipe(
                            Effect.map((body) => body?.skills ?? []),
                          ),
                        ),
                      },
                      { concurrency: 2 },
                    ).pipe(Effect.map((lists): ConsoleConfig => ({ ...remote, ...lists })))
                  : Effect.succeed(undefined),
              ),
              Effect.map((remote) => ({
                remote,
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
    // while the rest of the document merges through config.
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
      // The config merges as one integration document, which config loads right after managed policies.
      const document =
        next.remote &&
        next.connection &&
        ConfigIntegration.make({
          integrationID: Integration.ID.make("opencode"),
          connection:
            next.connection.type === "credential"
              ? { ...next.connection, id: Credential.ID.make(next.connection.id) }
              : next.connection,
          organization: next.organization,
          // `make` keeps only the standard config keys, so instructions and skills stay here.
          info: next.remote,
        })
      yield* integrate(document)
      // Managed `integration.use: deny` makes config layer a policies-only copy, which withholds instructions,
      // skills and event watches too. Config keeps the document it holds when handed a deep-equal one, so compare by
      // content.
      const allowed = document !== undefined && (!config.integration || isDeepStrictEqual(integrated, document))
      yield* syncInstructionsAndSkills(next, allowed)
      yield* syncWatches(allowed && next.remote?.watches === true ? next.connection : undefined)
    })
    // Watching starts when the Console's config says the workspace has event watches, and stops when it no longer does.
    const syncWatches = Effect.fnUntraced(
      function* (connection: ActiveConnection) {
        const credential = connection && (yield* ctx.integration.connection.resolve(connection))
        if (!connection || !credential || credential.type === "external") return yield* watches.sync(undefined)
        yield* watches.sync({
          key: workspaceKey(connection, credential),
          server: yield* normalizeServer(ConsoleAccess.server(credential)),
          headers: ctx.integration.connection
            .resolve(connection)
            .pipe(
              Effect.flatMap((current) =>
                current && current.type !== "external"
                  ? Effect.succeed(ConsoleAccess.headers(current))
                  : Effect.fail(new Error("OpenCode Console is not connected")),
              ),
            ),
        })
      },
      Effect.catch((cause) => Effect.logWarning("failed to start Console event watches", { cause })),
    )
    const syncInstructionsAndSkills = (next: typeof snapshot, allowed: boolean) => {
      const remote = allowed ? next.remote : undefined
      instructions = (remote?.instructions ?? []).map(
        (item) =>
          new InstructionDiscovery.File({ path: `OpenCode Console instruction ${item.id}`, content: item.content }),
      )
      if (!allowed) consoleSkills = { owner: "", items: [] }
      // Skills download in the background, so startup and config changes never wait on them. The current ones stay
      // until the download replaces them.
      return FiberHandle.run(
        skillDownload,
        loadSkills(next.connection, remote?.skills ?? []).pipe(
          Effect.flatMap((loaded) => {
            // A failed load keeps the skills already shown.
            if (!loaded) return Effect.void
            consoleSkills = { owner: owner(next), items: loaded }
            return skills.reload()
          }),
        ),
      )
    }
    const loadSkills = Effect.fnUntraced(
      function* (
        connection: ActiveConnection,
        listed: ReadonlyArray<{ readonly slug: string; readonly version: string }>,
      ) {
        if (listed.length === 0 || !connection) return []
        const credential = yield* ctx.integration.connection.resolve(connection)
        if (!credential || credential.type === "external") return []
        const server = yield* normalizeServer(ConsoleAccess.server(credential))
        const workspace = workspaceKey(connection, credential)
        const loaded = yield* Effect.forEach(
          listed,
          (item) => {
            const input = {
              key: `opencode-console-skill:${workspace}:${item.slug}`,
              interval: Duration.infinity,
              load: downloadSkill(http, server, item.slug, ConsoleAccess.headers(credential)).pipe(
                Effect.map((skill) => ({ version: item.version, skill })),
              ),
            }
            // Every project shares one download per skill. Any other version, or a failure, downloads again; a failed
            // download keeps the last copy that loaded.
            return cache.get(input).pipe(
              Effect.filterOrFail((cached) => cached.version === item.version),
              Effect.catch(() => cache.get({ ...input, force: true })),
              Effect.map((cached) => cached.skill),
              Effect.catch((cause) =>
                Effect.logWarning("failed to load Console skill", { slug: item.slug, cause }).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
          },
          { concurrency: 8 },
        )
        return loaded.filter((item) => item !== undefined)
      },
      Effect.catch((cause) => Effect.logWarning("failed to load Console skills", { cause }).pipe(Effect.as(undefined))),
    )
    const search = (providerID: WebSearch.ID, connection: NonNullable<ActiveConnection>) => ({
      id: providerID,
      name: "OpenCode Web Search",
      execute: (input: WebSearch.ProviderInput) =>
        Effect.gen(function* () {
          const active = yield* ctx.integration.connection.active("opencode")
          if (!active || IntegrationConnection.key(active) !== IntegrationConnection.key(connection))
            return yield* Effect.fail(new Error("OpenCode Console connection changed"))
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
          const response = yield* follow(http, request).pipe(
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

    yield* ctx.integration.transform((editor) => {
      editor.update("opencode", (integration) => {
        integration.name = "OpenCode Console"
      })
      editor.method.update(oauth(http))
      editor.method.update({ integrationID: "opencode", method: { type: "key", label: "API key (service account)" } })
    })

    snapshot = yield* load()
    yield* publish(snapshot)
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
    // The Console's config selects its provider only when the workspace enabled hosted search and the member's policy
    // allows it; otherwise its searches fail, so the provider is offered only then. The selection still merges as
    // config, where the user's own choice wins.
    yield* ctx.websearch.transform((editor) => {
      const provider = WebSearch.ID.make("opencode")
      if (snapshot.remote?.websearch && snapshot.remote.websearch.provider === provider && snapshot.connection)
        editor.add(search(provider, snapshot.connection))
    })
    yield* discovery.transform((editor) => instructions.forEach((file) => editor.add(file)))
    yield* skills.transform((editor) => {
      if (consoleSkills.owner !== owner(snapshot)) return
      consoleSkills.items.forEach((item) => editor.add(item.skill, item.files))
    })

    const apply = Effect.fn("OpencodePlugin.apply")(function* (next: typeof snapshot) {
      snapshot = next
      yield* publish(next)
      yield* guard(next)
      yield* Effect.all(
        [ctx.provider.reload(), ctx.websearch.reload(), ctx.mcp.reload(), discovery.reload(), skills.reload()],
        { concurrency: 5, discard: true },
      )
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(apply)))
    // Annotated: `apply` re-registers the hooks that call `check`, which would otherwise make inference circular.
    const check = (maxAge?: Duration.Input): Effect.Effect<void> =>
      loading.withPermit(
        Effect.gen(function* () {
          const next = yield* load(maxAge)
          if (!Equal.equals(snapshot, next)) yield* apply(next)
        }),
      )

    // Console inference rejects a missing SSO sign-in with a generic 401/403. Re-check the Console config, which
    // reports the reason, and replace the response with instructions when the connection needs the user.
    // A client retrying rejected inference would otherwise send one config request per failed response.
    const explain = (event: SessionHttpResponse) =>
      Effect.gen(function* () {
        if (event.response.status !== 401 && event.response.status !== 403) return
        yield* check(Duration.seconds(30))
        const status = reported
        if (!status) return
        void event.response.body?.cancel()
        event.response = Response.json(
          {
            error: {
              type: "authentication_error",
              message: `${status.message}.`,
            },
          },
          { status: event.response.status },
        )
      })
    // Hooks are scoped per provider so requests to unrelated providers skip the HTTP hook path.
    const guard = Effect.fn("OpencodePlugin.guard")(function* (next: typeof snapshot) {
      yield* Effect.forEach(explainers, (registration) => registration.dispose, { discard: true })
      explainers = yield* Effect.forEach(
        next.connection ? new Set([Provider.ID.opencode, ...Object.keys(next.remote?.providers ?? {})]) : [],
        (providerID) => ctx.session.hook("http.response", explain, { providerID }).pipe(Scope.provide(scope)),
      )
    })
    yield* guard(snapshot)

    // Console config can change independently of local credential activity, so re-fetch
    // periodically and only rebuild the catalog and search providers when the snapshot differs.
    // Only while connected: a signed-out location runs no timer and no credential lookups.
    const polling = yield* FiberHandle.make<void, never>()
    const poll = Effect.fnUntraced(function* () {
      if (!snapshot.connection) return yield* FiberHandle.clear(polling)
      yield* FiberHandle.run(polling, Effect.sleep(Duration.minutes(1)).pipe(Effect.andThen(check()), Effect.forever), {
        onlyIfMissing: true,
      })
    })
    yield* ProviderRefresh.onSwitch("opencode", refresh().pipe(Effect.andThen(poll())))
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
          const watches = response.headers[OpencodeWatches.header] !== undefined
          const body = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap((ok) => ok.json))
          return { ...(yield* Schema.decodeUnknownEffect(ConfigIntegration.Remote)(body)), watches }
        }),
      ),
      Effect.scoped,
      // A Console that accepts the connection but never answers would otherwise hold the load, including the one at
      // startup, indefinitely. A timeout is a transient failure, which `SharedCache` retries.
      Effect.timeout(Duration.seconds(5)),
    )
}

// A 404 (none in the workspace) or a 403 other than SSO (the sign-in may not read them) is an empty list. Any other
// error, including a malformed body, fails so the caller keeps the last list.
function fetchList<A>(
  http: HttpClient.HttpClient,
  value: Credential.Key | Credential.OAuth,
  path: string,
  schema: Schema.Decoder<A>,
) {
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${ConsoleAccess.server(value)}${path}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(ConsoleAccess.headers(value)),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status === 404) return undefined
          if (
            response.status === 403 &&
            Option.isNone(yield* HttpClientResponse.schemaBodyJson(SsoRequired)(response).pipe(Effect.option))
          )
            return undefined
          return yield* HttpClientResponse.schemaBodyJson(schema)(yield* HttpClientResponse.filterStatusOk(response))
        }),
      ),
      Effect.scoped,
      Effect.timeout(Duration.seconds(5)),
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

// API keys carry no account or org, so the sign-in itself identifies the workspace.
function workspaceKey(
  connection: NonNullable<Parameters<typeof IntegrationConnection.key>[0]>,
  credential: Credential.Key | Credential.OAuth,
) {
  return JSON.stringify([
    ConsoleAccess.server(credential),
    IntegrationConnection.key(connection),
    credential.metadata?.orgID,
  ])
}

function organizationName(credential: Credential.Value) {
  return typeof credential.metadata?.orgName === "string" ? credential.metadata.orgName : undefined
}

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
// Headers that name or authenticate the caller. They stay with the Console's origin when a redirect leaves it.
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-org-id"])

// The Console answers skill downloads with a presigned-storage redirect and web search through a gateway that may
// redirect too, so a redirect is a normal answer. Following it here, instead of letting fetch follow it, bounds the
// hops and keeps the connection's credentials from crossing an origin boundary.
function follow(
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  redirects = 0,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError | Error, Scope.Scope> {
  // Scoped per hop so a caller's timeout or interruption aborts the request in flight.
  return HttpClient.withScope(http)
    .execute(request)
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.flatMap((response) => {
        const location = response.headers.location
        if (!REDIRECT_STATUSES.has(response.status) || !location) return HttpClientResponse.filterStatusOk(response)
        if (redirects >= MAX_REDIRECTS) return Effect.fail(new Error(`Too many redirects (more than ${MAX_REDIRECTS})`))
        return Effect.flatMap(redirectTarget(request, location), (target) =>
          // Release this hop's connection before the next request instead of holding it until the download ends.
          HttpClientResponse.stream(Effect.succeed(response)).pipe(
            Stream.runDrain,
            // The redirect's own body is irrelevant, so failing to read it must not fail the download.
            Effect.ignore,
            Effect.andThen(follow(http, redirected(request, target, response.status), redirects + 1)),
          ),
        )
      }),
    )
}

function redirectTarget(request: HttpClientRequest.HttpClientRequest, location: string) {
  return Effect.try({
    try: () => {
      const target = new URL(location, request.url)
      if (target.protocol !== "http:" && target.protocol !== "https:")
        throw new Error(`redirect to unsupported protocol ${target.protocol}`)
      return target
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function redirected(request: HttpClientRequest.HttpClientRequest, target: URL, status: number) {
  // A 303 always, and a 301 or 302 after a POST, become a bodyless GET, as fetch would send them.
  const get = status === 303 || ((status === 301 || status === 302) && request.method === "POST")
  const headers =
    target.origin === new URL(request.url).origin
      ? request.headers
      : Object.fromEntries(Object.entries(request.headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name)))
  // `HttpClientRequest.method` is typed `string`, while `make` only accepts a known method.
  // The `href` string keeps the location's query exactly as sent: a `URL` would decode and re-encode it,
  // which breaks a presigned archive download whose signature covers the encoding.
  return HttpClientRequest.make(get ? "GET" : (request.method as HttpMethod.HttpMethod))(target.href, {
    headers,
    body: get ? HttpBody.empty : request.body,
  })
}

function downloadSkill(http: HttpClient.HttpClient, server: string, slug: string, headers: Record<string, string>) {
  return Effect.gen(function* () {
    if (!SkillDiscovery.isSafeSegment(slug)) return yield* Effect.fail(new Error(`unsafe skill slug: ${slug}`))
    const bundle = yield* follow(
      http,
      HttpClientRequest.get(`${server}/api/v2/skills/${encodeURIComponent(slug)}`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(headers),
      ),
    ).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(SkillBundle)), Effect.scoped, Effect.timeout("30 seconds"))
    if (bundle.slug !== slug) return yield* Effect.fail(new Error(`expected skill ${slug}, received ${bundle.slug}`))
    const unsafe = bundle.files.find((file) => !SkillDiscovery.isSafeRelativePath(file.path))
    if (unsafe) return yield* Effect.fail(new Error(`unsafe skill file path: ${unsafe.path}`))
    const main = bundle.files.find((file) => file.path === "SKILL.md")
    if (!main) return yield* Effect.fail(new Error(`skill ${slug} has no SKILL.md`))
    const parsed = SkillFile.parse(`/${slug}`, `/${slug}/SKILL.md`, main.content)
    if (parsed._tag !== "Parsed") return yield* Effect.fail(new Error(`skill ${slug} has an invalid SKILL.md`))
    return {
      skill: { ...parsed.skill, path: AbsolutePath.make(Skill.uri(slug, "SKILL.md")) },
      files: Object.fromEntries(
        bundle.files.filter((file) => file.path !== "SKILL.md").map((file) => [file.path, file.content]),
      ),
    } satisfies ConsoleSkill
  })
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
