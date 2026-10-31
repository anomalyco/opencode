import { isDeepStrictEqual } from "node:util"
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Equal,
  Exit,
  FiberHandle,
  Option,
  Schema,
  SchemaGetter,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHttpResponse } from "@opencode/plugin/effect/session"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
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
import { Skill } from "../../skill.js"
import { SkillDiscovery } from "../../skill/discovery.js"
import { WebSearch } from "../../websearch.js"

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
const Library = Schema.Struct({
  instructions: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, content: Schema.String })).pipe(
    Schema.optional,
  ),
  skills: Schema.Array(Schema.Struct({ slug: Schema.String, version: Schema.String })).pipe(Schema.optional),
})
// A malformed library is dropped instead of failing the whole Console config, which would drop its policies too.
const RemoteLibrary = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Library), {
    decode: SchemaGetter.transform((library) => Option.getOrUndefined(Schema.decodeUnknownOption(Library)(library))),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
const ConsoleConfig = Schema.Struct({
  ...ConfigIntegration.Remote.fields,
  library: RemoteLibrary.pipe(Schema.optional),
})
type ConsoleConfig = typeof ConsoleConfig.Type
const SkillBundle = Schema.Struct({
  slug: Schema.String,
  version: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
})
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

type LoadedSkill = {
  readonly skill: Skill.Info
  readonly files: Readonly<Record<string, string>>
}
const skillCache = new Map<string, { readonly version: string; readonly value: LoadedSkill | undefined }>()
const pendingSkills = new Map<string, Deferred.Deferred<LoadedSkill | undefined, unknown>>()

export const OpencodePlugin = define<
  HttpClient.HttpClient | Bus.Service | Config.Service | InstructionDiscovery.Service | Skill.Service | Scope.Scope
>({
  id: "opencode.provider.opencode",
  effect: Effect.fn(function* (ctx) {
    const disableFree = ["1", "true"].includes(process.env.OPENCODE_DISABLE_FREE_MODELS?.toLowerCase() ?? "")
    const bus = yield* Bus.Service
    const client = yield* HttpClient.HttpClient
    // Every request here goes to the Console, which reads the User-Agent to tell which OpenCode a member runs
    // and whether it evaluates the policies it is being sent.
    const http = HttpClient.mapRequest(client, HttpClientRequest.setHeader("User-Agent", App.useragent(ctx.app)))
    const config = yield* Config.Service
    const discovery = yield* InstructionDiscovery.Service
    const skills = yield* Skill.Service
    const scope = yield* Scope.Scope
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let snapshot: {
      // The Console's config: standard fields merge as an integration config layer while Library stays here.
      remote: ConsoleConfig | undefined
      connection: ActiveConnection
      organization: string | undefined
      // The Console server the config came from, which serves its Library's skill files.
      origin: string | undefined
      orgID: string | undefined
    } = { remote: undefined, connection: undefined, organization: undefined, origin: undefined, orgID: undefined }
    // Status last reported for the active connection, so inference failures can name the fix.
    let reported: IntegrationConnection.Status | undefined
    let explainers: Effect.Success<ReturnType<typeof ctx.session.hook>>[] = []
    // When the last Console config load started, so rejected inference can reuse a recent status.
    let checked = Number.NEGATIVE_INFINITY
    let currentInstructions: InstructionDiscovery.File[] = []
    let currentSkills: LoadedSkill[] = []
    let skillsKey: string | undefined = "none"

    const load = Effect.fn("OpencodePlugin.load")(function* () {
      checked = yield* Clock.currentTimeMillis
      const connection = yield* ctx.integration.connection.active("opencode")
      if (!connection) {
        reported = undefined
        return { remote: undefined, connection, organization: undefined, origin: undefined, orgID: undefined }
      }
      const status = (status: IntegrationConnection.Status | undefined) => {
        reported = status
        return ctx.integration.connection.status({ integrationID: "opencode", connection, status })
      }
      return yield* ctx.integration.connection.resolve(connection).pipe(
        Effect.flatMap((credential) => {
          if (!credential || credential.type === "external")
            return Effect.succeed<typeof snapshot>({
              remote: undefined,
              connection,
              organization: undefined,
              origin: undefined,
              orgID: undefined,
            })
          return Effect.all([fetchConfig(http, credential), normalizeServer(ConsoleAccess.server(credential))]).pipe(
            Effect.map(([remote, origin]) => ({
              remote,
              connection,
              organization: organizationName(credential),
              origin,
              orgID: typeof credential.metadata?.orgID === "string" ? credential.metadata.orgID : undefined,
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
              ? {
                  remote: snapshot.remote,
                  connection,
                  organization: snapshot.organization,
                  origin: snapshot.origin,
                  orgID: snapshot.orgID,
                }
              : { remote: undefined, connection, organization: undefined, origin: undefined, orgID: undefined }
          }),
        ),
      )
    })
    // The Console document submitted to config, and the document config layered back. Managed `integration.use: deny`
    // replaces `submitted` with a policies-only document (`integrated !== submitted`), withholding everything else.
    let submitted: ConfigIntegration.Document | undefined
    let integrated: ConfigIntegration.Document | undefined
    const allowed = () => Boolean(submitted && (!config.integration || integrated === submitted))
    const readIntegrated = () =>
      config
        .entries()
        .pipe(
          Effect.map((entries) =>
            entries.find(
              (entry): entry is ConfigIntegration.Document =>
                entry instanceof ConfigIntegration.Document && entry.integrationID === Integration.ID.make("opencode"),
            ),
          ),
        )
    // Policies and providers ride on the snapshot, so a credential switch, disconnect, or 404 replaces them too.
    const publish = Effect.fnUntraced(function* (next: typeof snapshot) {
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
          info: {
            providers: next.remote.providers,
            mcp: next.remote.mcp,
            policies: next.remote.policies,
            websearch: next.remote.websearch,
          },
        })
      if (!isDeepStrictEqual(submitted, document)) {
        submitted = document
        yield* config.integration?.(Integration.ID.make("opencode"), submitted) ?? Effect.void
      }
      integrated = yield* readIntegrated()
    })

    // A version already cached in memory costs no request; a failed download keeps the previous version.
    const librarySkill = Effect.fnUntraced(function* (input: {
      url: string
      headers: Effect.Effect<Record<string, string>, unknown>
      scope: readonly [string, string, string]
      slug: string
      version: string
    }) {
      const slugKey = JSON.stringify([...input.scope, input.slug])
      const cached = skillCache.get(slugKey)
      if (cached?.version === input.version) return { item: cached.value, fresh: true }
      const versionKey = JSON.stringify([...input.scope, input.slug, input.version])
      return yield* Effect.gen(function* () {
        const pending = pendingSkills.get(versionKey)
        if (pending) {
          const exit = yield* Effect.exit(Deferred.await(pending))
          if (Exit.isSuccess(exit)) return { item: exit.value, fresh: true }
          if (!Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
        }
        const deferred = Deferred.makeUnsafe<LoadedSkill | undefined, unknown>()
        const value = yield* Effect.uninterruptibleMask((restore) => {
          pendingSkills.set(versionKey, deferred)
          return restore(downloadSkill(http, input)).pipe(
            Effect.tap((loaded) =>
              Effect.sync(() => {
                skillCache.set(slugKey, { version: input.version, value: loaded })
              }),
            ),
            Effect.onExit((exit) => {
              if (pendingSkills.get(versionKey) === deferred) pendingSkills.delete(versionKey)
              return Deferred.done(deferred, exit)
            }),
          )
        })
        return { item: value, fresh: true }
      }).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
          return Effect.logWarning("failed to download Console skill", {
            slug: input.slug,
            version: input.version,
            cause,
          }).pipe(Effect.as({ item: skillCache.get(slugKey)?.value, fresh: false }))
        }),
      )
    })

    const syncLibrary = Effect.fnUntraced(function* (next: typeof snapshot) {
      if (!allowed()) {
        currentInstructions = []
        currentSkills = []
        skillsKey = "none"
        return
      }
      // Keyed by ID, which stays put across renames and edits, so changes render as diffs.
      currentInstructions = (next.remote?.library?.instructions ?? []).map(
        (instruction) =>
          new InstructionDiscovery.File({
            path: `OpenCode Console instruction ${instruction.id}`,
            content: instruction.content,
          }),
      )
      const origin = next.origin
      const connection = next.connection
      const listed = next.remote?.library?.skills ?? []
      if (!origin || !connection || listed.length === 0) {
        currentSkills = []
        skillsKey = "none"
        return
      }
      const scope = [origin, IntegrationConnection.key(connection) ?? "", next.orgID ?? ""] as const
      const key = JSON.stringify([...scope, listed])
      if (key === skillsKey) return
      // Only a download needs the credential, so cached skills cost no token refresh and survive a failed one.
      const headers = yield* Effect.cached(
        Effect.gen(function* () {
          const credential = yield* ctx.integration.connection.resolve(connection)
          if (!credential || credential.type === "external")
            return yield* Effect.fail(new Error("OpenCode Console is not connected"))
          const orgID = typeof credential.metadata?.orgID === "string" ? credential.metadata.orgID : undefined
          if (orgID !== next.orgID) return yield* Effect.fail(new Error("OpenCode Console switched workspaces"))
          return ConsoleAccess.headers(credential)
        }),
      )
      const loaded = yield* Effect.forEach(
        listed.filter((skill) => SkillDiscovery.isSafeSegment(skill.slug)),
        (skill) =>
          librarySkill({
            url: `${origin}/api/v2/library/skills/${encodeURIComponent(skill.slug)}`,
            headers,
            scope,
            slug: skill.slug,
            version: skill.version,
          }),
        { concurrency: 4 },
      ).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
          return Effect.logWarning("failed to load Console skills", { cause }).pipe(Effect.as(undefined))
        }),
      )
      currentSkills = Array.from(
        new Map(
          (loaded ?? []).flatMap((entry) => (entry.item ? [[entry.item.skill.id, entry.item] as const] : [])),
        ).values(),
      )
      skillsKey = loaded?.every((item) => item.fresh) ? key : undefined
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

    yield* ctx.integration.transform((editor) => {
      editor.update("opencode", (integration) => {
        integration.name = "OpenCode Console"
      })
      editor.method.update(oauth(http))
      editor.method.update({ integrationID: "opencode", method: { type: "key", label: "API key (service account)" } })
    })

    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() =>
        loading.withPermit(
          Effect.gen(function* () {
            const wasAllowed = allowed()
            integrated = yield* readIntegrated()
            if (allowed() === wasAllowed) return
            yield* syncLibrary(snapshot)
            yield* Effect.all([ctx.provider.reload(), ctx.websearch.reload(), discovery.reload(), skills.reload()], {
              concurrency: 4,
              discard: true,
            })
          }),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* loading.withPermit(
      Effect.gen(function* () {
        snapshot = yield* load()
        yield* publish(snapshot)
        yield* syncLibrary(snapshot)
      }),
    )
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
      if (
        allowed() &&
        snapshot.remote?.websearch &&
        snapshot.remote.websearch.provider === provider &&
        snapshot.connection
      )
        editor.add(search(provider, snapshot.connection))
    })
    yield* discovery.transform((editor) => {
      currentInstructions.forEach((file) => editor.add(file))
    })
    yield* skills.transform((editor) => {
      currentSkills.forEach((item) => editor.add(item.skill, item.files))
    })

    const apply = Effect.fn("OpencodePlugin.apply")(function* (next: typeof snapshot) {
      snapshot = next
      yield* publish(next)
      yield* syncLibrary(next)
      yield* guard(next)
      yield* Effect.all(
        [ctx.provider.reload(), ctx.websearch.reload(), ctx.mcp.reload(), discovery.reload(), skills.reload()],
        { concurrency: 5, discard: true },
      )
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(apply)))
    // Annotated: `apply` re-registers the hooks that call `check`, which would otherwise make inference circular.
    // With `maxAge`, a load that started within it is reused; checking inside the permit lets concurrent callers
    // share the load that was in flight when they arrived.
    const check = (maxAge = Duration.zero): Effect.Effect<void> =>
      loading.withPermit(
        Effect.gen(function* () {
          if ((yield* Clock.currentTimeMillis) - checked < Duration.toMillis(maxAge)) return
          const next = yield* load()
          if (!Equal.equals(snapshot, next)) return yield* apply(next)
          if (skillsKey !== undefined) return
          const before = currentSkills
          yield* syncLibrary(snapshot)
          if (!isDeepStrictEqual(before, currentSkills)) yield* skills.reload()
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
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("opencode")),
      Stream.runForEach(() => refresh().pipe(Effect.andThen(poll()))),
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
          return yield* Schema.decodeUnknownEffect(ConsoleConfig)(body)
        }),
      ),
      Effect.scoped,
    )
}

function downloadSkill(
  http: HttpClient.HttpClient,
  input: {
    url: string
    headers: Effect.Effect<Record<string, string>, unknown>
    slug: string
  },
) {
  return Effect.gen(function* () {
    const headers = yield* input.headers
    const bundle = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
      .execute(
        HttpClientRequest.get(input.url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(headers)),
      )
      .pipe(
        // The connection's credentials must not follow a redirect to another server.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SkillBundle)),
        Effect.scoped,
        Effect.timeout("30 seconds"),
      )
    if (bundle.slug !== input.slug)
      return yield* Effect.fail(new Error(`expected skill ${input.slug}, received ${bundle.slug}`))
    const unsafe = bundle.files.find((file) => !SkillDiscovery.isSafeRelativePath(file.path))
    if (unsafe) return yield* Effect.fail(new Error(`unsafe skill file path: ${unsafe.path}`))
    const main = bundle.files.find((file) => file.path === "SKILL.md")
    if (!main) return yield* Effect.fail(new Error(`skill ${input.slug} has no SKILL.md`))
    const filepath = Skill.uri(input.slug, "SKILL.md")
    const parsed = SkillFile.parse(`/${input.slug}`, `/${input.slug}/SKILL.md`, main.content)
    if (parsed._tag !== "Parsed") {
      yield* Effect.logDebug("skill file skipped", {
        filepath,
        reason: parsed.reason,
        ...(parsed.reason === "frontmatter" ? { issue: parsed.issue } : {}),
      })
      return undefined
    }
    const files = Object.fromEntries(
      bundle.files.filter((file) => file.path !== "SKILL.md").map((file) => [file.path, file.content]),
    )
    return {
      skill: { ...parsed.skill, path: AbsolutePath.make(filepath) },
      files,
    } satisfies LoadedSkill
  })
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
