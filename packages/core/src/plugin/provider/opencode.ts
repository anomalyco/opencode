import { Clock, Duration, Effect, Equal, FiberHandle, Option, Schema, Scope, Semaphore, Stream } from "effect"
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
// The workspace Library: instructions arrive whole, skills as versions whose files download separately.
const Library = Schema.Struct({
  instructions: Schema.Array(Schema.Struct({ id: Schema.String, content: Schema.String })).pipe(Schema.optional),
  skills: Schema.Array(Schema.Struct({ slug: Schema.String, version: Schema.String })).pipe(Schema.optional),
})
// `library` decodes where it's used, so a malformed one can't fail the config and drop its policies.
const ConsoleConfig = Schema.Struct({
  ...ConfigIntegration.Remote.fields,
  library: Schema.Unknown.pipe(Schema.optional),
})
const SkillBundle = Schema.Struct({
  slug: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
})
type LibrarySkill = { readonly skill: Skill.Info; readonly files: Record<string, string> }
// Downloaded skills by sign-in and workspace, then slug. Shared by every project in this process, so a skill downloads again
// only when its version changes.
const downloaded = new Map<
  string,
  Map<string, { readonly slug: string; readonly version: string; readonly skill: LibrarySkill }>
>()
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
      // The Console's regular OpenCode config, merged as an integration config layer.
      remote: typeof ConsoleConfig.Type | undefined
      connection: ActiveConnection
      organization: string | undefined
    } = { remote: undefined, connection: undefined, organization: undefined }
    let instructions: InstructionDiscovery.File[] = []
    // Tagged with the account and workspace they were downloaded for, so a switch hides them right away.
    let librarySkills: { owner: string; items: LibrarySkill[] } = { owner: "", items: [] }
    const owner = (from: typeof snapshot) =>
      `${IntegrationConnection.key(from.connection) ?? ""}:${from.organization ?? ""}`
    // A newer config's skill download replaces one still in flight.
    const skillDownload = yield* FiberHandle.make<void, never>()
    // Status last reported for the active connection, so inference failures can name the fix.
    let reported: IntegrationConnection.Status | undefined
    let explainers: Effect.Success<ReturnType<typeof ctx.session.hook>>[] = []
    // When the last Console config load started, so rejected inference can reuse a recent status.
    let checked = Number.NEGATIVE_INFINITY

    const load = Effect.fn("OpencodePlugin.load")(function* () {
      checked = yield* Clock.currentTimeMillis
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
          return fetchConfig(http, credential).pipe(
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
          // `make` keeps only the standard config keys, so `library` stays here.
          info: next.remote,
        })
      yield* integrate(document)
      // Managed `integration.use: deny` makes config layer a policies-only copy, which withholds the Library too.
      yield* syncLibrary(next, document !== undefined && (!config.integration || integrated === document))
    })
    const syncLibrary = (next: typeof snapshot, allowed: boolean) => {
      const library = allowed
        ? Option.getOrUndefined(Schema.decodeUnknownOption(Library)(next.remote?.library))
        : undefined
      instructions = (library?.instructions ?? []).map(
        (item) =>
          new InstructionDiscovery.File({ path: `OpenCode Console instruction ${item.id}`, content: item.content }),
      )
      if (!allowed) librarySkills = { owner: "", items: [] }
      // Skills download in the background, so startup and config changes never wait on them. The current ones stay
      // until the download replaces them.
      return FiberHandle.run(
        skillDownload,
        loadSkills(next.connection, library?.skills ?? []).pipe(
          Effect.flatMap((loaded) => {
            // A failed load keeps the skills already shown.
            if (!loaded) return Effect.void
            librarySkills = { owner: owner(next), items: loaded }
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
        // API keys carry no account or org, so the sign-in itself identifies the workspace.
        const workspace = JSON.stringify([server, IntegrationConnection.key(connection), credential.metadata?.orgID])
        const cached = downloaded.get(workspace)
        const loaded = yield* Effect.forEach(
          listed,
          (item) => {
            const previous = cached?.get(item.slug)
            if (previous?.version === item.version) return Effect.succeed(previous)
            return downloadSkill(http, server, item.slug, ConsoleAccess.headers(credential)).pipe(
              Effect.map((skill) => ({ slug: item.slug, version: item.version, skill })),
              // A failed download keeps the last copy that loaded, and retries on the next config change.
              Effect.catch((cause) =>
                Effect.logWarning("failed to load Console skill", { slug: item.slug, cause }).pipe(Effect.as(previous)),
              ),
            )
          },
          { concurrency: 8 },
        )
        const kept = loaded.filter((item) => item !== undefined)
        downloaded.set(workspace, new Map(kept.map((item) => [item.slug, item])))
        return kept.map((item) => item.skill)
      },
      Effect.catch((cause) => Effect.logWarning("failed to load Console skills", { cause }).pipe(Effect.as(undefined))),
    )
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
      if (librarySkills.owner !== owner(snapshot)) return
      librarySkills.items.forEach((item) => editor.add(item.skill, item.files))
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
    // With `maxAge`, a load that started within it is reused; checking inside the permit lets concurrent callers
    // share the load that was in flight when they arrived.
    const check = (maxAge = Duration.zero): Effect.Effect<void> =>
      loading.withPermit(
        Effect.gen(function* () {
          if ((yield* Clock.currentTimeMillis) - checked < Duration.toMillis(maxAge)) return
          const next = yield* load()
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

function downloadSkill(http: HttpClient.HttpClient, server: string, slug: string, headers: Record<string, string>) {
  return Effect.gen(function* () {
    if (!SkillDiscovery.isSafeSegment(slug)) return yield* Effect.fail(new Error(`unsafe skill slug: ${slug}`))
    const bundle = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
      .execute(
        HttpClientRequest.get(`${server}/api/v2/library/skills/${encodeURIComponent(slug)}`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeaders(headers),
        ),
      )
      .pipe(
        // The connection's credentials must not follow a redirect to another server.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SkillBundle)),
        Effect.scoped,
        Effect.timeout("30 seconds"),
      )
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
    } satisfies LibrarySkill
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
