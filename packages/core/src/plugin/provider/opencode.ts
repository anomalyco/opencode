import { isDeepStrictEqual } from "node:util"
import { Duration, Effect, Equal, Option, Schema, Scope, Semaphore, Stream } from "effect"
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
const ConsoleRemote = Schema.Struct({ ...ConfigIntegration.Remote.fields, watches: Schema.Boolean })
// Everything a workspace's Console delivers.
type ConsoleConfig = typeof ConsoleRemote.Type & typeof ConsoleInstructions.Type & typeof ConsoleSkills.Type
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

// The sign-in now belongs to another server or organization, so this workspace's sources must not load its answers.
class WorkspaceMovedError extends Schema.TaggedError<WorkspaceMovedError>()("OpencodeConsole.WorkspaceMoved", {}) {}

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
  | Credential.Service
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
    const bus = yield* Bus.Service
    const credentials = yield* Credential.Service
    const scope = yield* Scope.Scope
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    type Snapshot = {
      // The Console's regular OpenCode config, merged as an integration config layer.
      readonly remote?: ConsoleConfig
      readonly connection: ActiveConnection
      readonly organization?: string
      // The server, sign-in and organization `remote` belongs to.
      readonly workspace?: string
    }
    let snapshot: Snapshot = { connection: undefined }
    let instructions: InstructionDiscovery.File[] = []
    // Tagged with the workspace they were downloaded for, so a switch hides them right away.
    let consoleSkills: { workspace: string | undefined; items: ConsoleSkill[] } = { workspace: undefined, items: [] }
    // Status last reported for the active connection, so inference failures can name the fix without asking Console.
    let reported: IntegrationConnection.Status | undefined
    let explainers: Effect.Success<ReturnType<typeof ctx.session.hook>>[] = []
    const watches = yield* OpencodeWatches.make(ctx, http)
    const applying = Semaphore.makeUnsafe(1)

    // What the active connection's workspace delivers. Every project signed in to the same workspace shares one
    // refresh of each resource, and the last good copy of each is saved, so a restart, a newly opened project or a
    // Console outage, including one that wants the user to sign in again, keeps the organization's policies.
    type Workspace = {
      readonly current: () => boolean
      readonly connection: ActiveConnection
      readonly organization?: string
      readonly workspace?: string
      readonly sources?: {
        readonly config: SharedCache.Source<typeof ConsoleRemote.Type | null, unknown>
        readonly instructions: SharedCache.Source<typeof ConsoleInstructions.Type, unknown>
        readonly skills: SharedCache.Source<typeof ConsoleSkills.Type, unknown>
        readonly bundles: (listed: ConsoleConfig["skills"]) => Effect.Effect<void>
      }
    }
    // The Console document as config layered it. Its providers apply at this plugin's position in the provider chain,
    // while the rest of the document merges through config.
    let integrated: ConfigIntegration.Document | undefined
    // Whether config took the whole document. Managed `integration.use: deny` makes config layer a policies-only copy,
    // which withholds instructions, skills and event watches too.
    let allowed = false
    // Policies and providers ride on the snapshot, so a credential switch, disconnect, or 404 replaces them too.
    const publish = Effect.fnUntraced(function* (selection: Workspace) {
      // The config merges as one integration document, which config loads right after managed policies.
      const document =
        snapshot.remote &&
        snapshot.connection &&
        ConfigIntegration.make({
          integrationID: Integration.ID.make("opencode"),
          connection:
            snapshot.connection.type === "credential"
              ? { ...snapshot.connection, id: Credential.ID.make(snapshot.connection.id) }
              : snapshot.connection,
          organization: snapshot.organization,
          // `make` keeps only the standard config keys, so instructions and skills stay here.
          info: snapshot.remote,
        })
      yield* config.integration?.(Integration.ID.make("opencode"), document) ?? Effect.void
      integrated = (yield* config.entries()).find(
        (entry): entry is ConfigIntegration.Document =>
          entry instanceof ConfigIntegration.Document && entry.integrationID === Integration.ID.make("opencode"),
      )
      // Config keeps the document it holds when handed a deep-equal one, so compare by content.
      allowed = document !== undefined && (!config.integration || isDeepStrictEqual(integrated, document))
      instructions = ((allowed && snapshot.remote?.instructions) || []).map(
        (item) =>
          new InstructionDiscovery.File({ path: `OpenCode Console instruction ${item.id}`, content: item.content }),
      )
      if (!allowed) consoleSkills = { workspace: undefined, items: [] }
      yield* selection.sources?.bundles((allowed && snapshot.remote?.skills) || []) ?? Effect.void
      yield* syncWatches(allowed && snapshot.remote?.watches === true ? snapshot.connection : undefined)
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
    // A skill version never changes, so each one is a source that loads once, shared by every project. A failed
    // download tries again within a minute. Skills download in the background, so startup and config changes never
    // wait on them, and the ones shown stay until a new list's downloads replace them.
    const skillBundles = Effect.fnUntraced(function* (
      workspace: string,
      access: Effect.Effect<Credential.Key | Credential.OAuth, unknown>,
    ) {
      const hold = yield* ProviderRefresh.holder()
      const lock = Semaphore.makeUnsafe(1)
      return (listed: ConsoleConfig["skills"]) =>
        lock.withPermit(
          hold({
            key: JSON.stringify(listed),
            acquire: (current) =>
              Effect.gen(function* () {
                const bundles = yield* Effect.forEach(listed, (item) =>
                  cache.source({
                    key: `opencode-console:${workspace}:skill:${item.slug}@${item.version}`,
                    interval: Duration.infinity,
                    load: access.pipe(
                      Effect.flatMap((latest) =>
                        normalizeServer(ConsoleAccess.server(latest)).pipe(
                          Effect.flatMap((server) =>
                            downloadSkill(http, server, item.slug, ConsoleAccess.headers(latest)),
                          ),
                        ),
                      ),
                    ),
                  }),
                )
                yield* Stream.mergeAll(
                  bundles.map((bundle) => bundle.changes),
                  { concurrency: "unbounded" },
                ).pipe(
                  Stream.runForEach(() =>
                    Effect.gen(function* () {
                      const loaded = (yield* Effect.forEach(bundles, (bundle) => bundle.current)).flatMap((state) =>
                        Option.toArray(state.value),
                      )
                      if (!current() || snapshot.workspace !== workspace) return
                      if (consoleSkills.workspace === workspace && Equal.equals(loaded, consoleSkills.items)) return
                      consoleSkills = { workspace, items: loaded }
                      yield* skills.reload()
                    }),
                  ),
                  Effect.forkScoped({ startImmediately: true }),
                )
                // Nothing listed has no source to tell, so it clears the shown skills here.
                if (listed.length === 0 && consoleSkills.items.length > 0) {
                  consoleSkills = { workspace, items: [] }
                  yield* skills.reload()
                }
              }),
          }),
        )
    })
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

    // Console inference rejects a missing SSO sign-in with a generic 401/403. The Console config's latest refresh
    // reports the reason, so the response is replaced with instructions when the connection needs the user, without
    // asking Console again.
    const explain = (event: SessionHttpResponse) =>
      Effect.gen(function* () {
        if (event.response.status !== 401 && event.response.status !== 403) return
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
    const guard = Effect.fn("OpencodePlugin.guard")(function* () {
      yield* Effect.forEach(explainers, (registration) => registration.dispose, { discard: true })
      explainers = yield* Effect.forEach(
        snapshot.connection ? new Set([Provider.ID.opencode, ...Object.keys(snapshot.remote?.providers ?? {})]) : [],
        (providerID) => ctx.session.hook("http.response", explain, { providerID }).pipe(Scope.provide(scope)),
      )
    })

    // Applies the selected workspace's sources: the config's failure becomes the connection status, and a changed
    // snapshot is published. Startup applies without reloading, since nothing was built from it yet.
    const apply = (selection: Workspace, reload: boolean) =>
      applying.withPermit(
        Effect.gen(function* () {
          const sources = selection.sources
          const [config, lists] = sources
            ? [
                yield* sources.config.current,
                {
                  ...Option.getOrElse((yield* sources.instructions.current).value, () => ({ instructions: [] })),
                  ...Option.getOrElse((yield* sources.skills.current).value, () => ({ skills: [] })),
                },
              ]
            : [undefined, undefined]
          if (!selection.current()) return
          const failure = config && Option.getOrUndefined(config.failure)
          if (failure instanceof WorkspaceMovedError) yield* reselect
          // Only well-formed Console errors change the connection status; anything else may be transient.
          const status = failure === undefined ? undefined : connectionStatus(failure)
          if (selection.connection && (failure === undefined || status)) {
            reported = status
            yield* ctx.integration.connection.status({
              integrationID: "opencode",
              connection: selection.connection,
              status,
            })
          }
          if (!selection.connection) reported = undefined
          const remote = config && Option.getOrUndefined(config.value)
          const next: Snapshot = {
            remote: remote ? { ...remote, ...lists } : undefined,
            connection: selection.connection,
            organization: selection.organization,
            workspace: selection.workspace,
          }
          if (Equal.equals(next, snapshot)) return
          snapshot = next
          yield* publish(selection)
          yield* guard()
          if (!reload) return
          yield* Effect.all(
            [ctx.provider.reload(), ctx.websearch.reload(), ctx.mcp.reload(), discovery.reload(), skills.reload()],
            { concurrency: 5, discard: true },
          )
        }),
      )
    // Waits only for sources with nothing saved; one that fails leaves the rest.
    const ready = (selection: Workspace) =>
      Effect.all(
        selection.sources
          ? [selection.sources.config.get, selection.sources.instructions.get, selection.sources.skills.get].map(
              (source: Effect.Effect<unknown, unknown>) => Effect.ignore(source),
            )
          : [],
        { concurrency: "unbounded", discard: true },
      )
    const selected: { current?: Workspace } = {}
    // Set once `follow` returns; a sign-in moved to another workspace selects that one.
    let reselect = Effect.void
    const followed = yield* ProviderRefresh.follow({
      integrationID: "opencode",
      select: Effect.gen(function* () {
        const connection = yield* ctx.integration.connection.active("opencode")
        // The stored credential names the workspace, so selecting one never refreshes a token or asks Console.
        const credential = !connection
          ? undefined
          : connection.type === "env"
            ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
            : (yield* credentials.get(Credential.ID.make(connection.id)))?.value
        if (!connection || !credential || credential.type === "external")
          return {
            key: `none:${IntegrationConnection.key(connection)}`,
            acquire: (current: () => boolean) => apply((selected.current = { current, connection }), true),
          }
        const workspace = workspaceKey(connection, credential)
        return {
          key: workspace,
          acquire: (current: () => boolean) =>
            Effect.gen(function* () {
              // Each refresh signs in again, since tokens rotate, and never stores another workspace's answer here.
              const access = ctx.integration.connection
                .resolve(connection)
                .pipe(
                  Effect.flatMap((latest) =>
                    !latest || latest.type === "external"
                      ? Effect.fail(new Error("OpenCode Console is not connected"))
                      : workspaceKey(connection, latest) !== workspace
                        ? Effect.fail(new WorkspaceMovedError())
                        : Effect.succeed(latest),
                  ),
                )
              const source = <A>(name: string, schema: Schema.Codec<A, unknown>, load: Effect.Effect<A, unknown>) =>
                cache.source({
                  key: `opencode-console:${workspace}:${name}`,
                  interval: Duration.minutes(1),
                  persist: Schema.toCodecJson(schema),
                  load,
                })
              const config = yield* source(
                "config",
                Schema.NullOr(ConsoleRemote),
                access.pipe(Effect.flatMap((latest) => fetchConfig(http, latest))),
              )
              // Each list has its own source, so a failing or malformed one keeps its last copy, or none, and never
              // holds back the config and its policies. A workspace without a config has no lists to ask for.
              const list = <A>(name: string, schema: Schema.Codec<A, unknown>, empty: A) =>
                source(
                  name,
                  schema,
                  config.get.pipe(
                    Effect.option,
                    Effect.flatMap((remote) =>
                      Option.isSome(remote) && remote.value
                        ? access.pipe(
                            Effect.flatMap((latest) => fetchList(http, latest, `/api/v2/${name}`, schema)),
                            Effect.map((body) => body ?? empty),
                          )
                        : Effect.succeed(empty),
                    ),
                  ),
                )
              const sources = {
                config,
                instructions: yield* list("instructions", ConsoleInstructions, { instructions: [] }),
                skills: yield* list("skills", ConsoleSkills, { skills: [] }),
                bundles: yield* skillBundles(workspace, access),
              }
              const next: Workspace = {
                current,
                connection,
                organization: organizationName(credential),
                workspace,
                sources,
              }
              selected.current = next
              // Waits like startup does, so a workspace with nothing saved yet keeps the previous policies until its
              // first answer.
              yield* ready(next).pipe(
                Effect.andThen(
                  Stream.mergeAll(
                    [sources.config.changes, sources.instructions.changes, sources.skills.changes].map(
                      (changes: Stream.Stream<unknown>) => changes,
                    ),
                    { concurrency: 3 },
                  ).pipe(Stream.runForEach(() => apply(next, true))),
                ),
                Effect.forkScoped({ startImmediately: true }),
              )
            }),
        }
      }),
    })

    reselect = followed.reselect

    // Startup applies the workspace's saved config at once. Only without one does it wait for the Console.
    const startup = selected.current
    if (startup) {
      yield* ready(startup)
      // Signing in may refresh a token whose organization changed; that organization's workspace applies instead.
      const config = startup.sources && (yield* startup.sources.config.current)
      if (config && Option.getOrUndefined(config.failure) instanceof WorkspaceMovedError) yield* followed.update
      const current = selected.current ?? startup
      yield* ready(current)
      yield* apply(current, false)
    }

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
      if (consoleSkills.workspace !== snapshot.workspace) return
      consoleSkills.items.forEach((item) => editor.add(item.skill, item.files))
    })

    // A removed login's saved Console config is of no further use.
    yield* bus.subscribe(Credential.Event.Updated).pipe(
      Stream.filter((event) => event.data.integrationID === "opencode"),
      Stream.runForEach(
        Effect.fnUntraced(function* (event) {
          if (yield* credentials.get(event.data.credentialID)) return
          yield* cache.forget(
            `opencode-console:${IntegrationConnection.key({ type: "credential", id: event.data.credentialID })}:`,
          )
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
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
          if (response.status === 404) return null
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
  return `${IntegrationConnection.key(connection)}:${JSON.stringify([ConsoleAccess.server(credential), credential.metadata?.orgID])}`
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
