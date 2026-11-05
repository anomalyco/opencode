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
import { ProviderRefresh } from "./refresh.js"

const clientID = "opencode-cli"
// The workspace Library: instructions arrive whole, skills as versions whose files download separately.
const Library = Schema.Struct({
  instructions: Schema.Array(Schema.Struct({ id: Schema.String, content: Schema.String })).pipe(Schema.optional),
  skills: Schema.Array(Schema.Struct({ slug: Schema.String, version: Schema.String })).pipe(Schema.optional),
})
const SkillBundle = Schema.Struct({
  slug: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, content: Schema.String })),
})
type LibrarySkill = { readonly skill: Skill.Info; readonly files: Record<string, string> }

function oauth(http: HttpClient.HttpClient) {
  return {
    integrationID: Integration.ID.make("opencode"),
    method: {
      id: ConsoleAccess.methodID,
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
      ConsoleAccess.authorize(http, answer.server ?? ConsoleAccess.defaultServer, clientID).pipe(
        Effect.map((device) => ({
          mode: "auto" as const,
          url: device.url,
          instructions: `Enter code: ${device.code}`,
          callback: device.callback,
        })),
      ),
    refresh: (credential) => ConsoleAccess.refresh(http, credential, clientID),
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
    const settings = yield* ConsoleAccess.Options
    const loading = Semaphore.makeUnsafe(1)
    type ActiveConnection = Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    let snapshot: {
      // The Console's regular OpenCode config, merged as an integration config layer.
      remote: ConsoleAccess.Config | undefined
      connection: ActiveConnection
      organization: string | undefined
      // Fingerprint of an API key, so a key replaced in place counts as a new sign-in.
      access: string | undefined
    } = { remote: undefined, connection: undefined, organization: undefined, access: undefined }
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

    // Every project signed in to the same workspace shares one fetch, reused while it is younger than `maxAge`.
    // A failed load reports only its connection: what it falls back to depends on the snapshot, which is read under
    // `loading` when the outcome is applied.
    const load = Effect.fn("OpencodePlugin.load")(function* (
      maxAge: Duration.Input = Duration.minutes(1),
    ): Effect.fn.Return<
      | { readonly _tag: "Loaded"; readonly next: typeof snapshot }
      | { readonly _tag: "Failed"; readonly connection: ActiveConnection }
    > {
      const connection = yield* ctx.integration.connection.active("opencode")
      if (!connection) {
        reported = undefined
        return { _tag: "Loaded", next: { remote: undefined, connection, organization: undefined, access: undefined } }
      }
      const status = (status: IntegrationConnection.Status | undefined) => {
        reported = status
        return ctx.integration.connection.status({ integrationID: "opencode", connection, status })
      }
      return yield* ctx.integration.connection.resolve(connection).pipe(
        Effect.flatMap((credential) => {
          if (!credential || credential.type === "external")
            return Effect.succeed({ remote: undefined, connection, organization: undefined, access: undefined })
          return cache
            .get({
              key: `opencode-console:${workspaceKey(connection, credential)}`,
              interval: maxAge,
              // A sign-in error is Console's answer for this sign-in, so it is shared like a config rather than
              // replaced by the last config, as a network failure is.
              load: ConsoleAccess.fetchConfig(http, credential).pipe(
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
              Effect.map((remote) => ({
                remote,
                connection,
                organization: ConsoleAccess.organizationName(credential),
                access: accessFingerprint(credential),
              })),
            )
        }),
        Effect.tap(() => status(undefined)),
        Effect.map((next) => ({ _tag: "Loaded" as const, next })),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            // Only well-formed Console errors change the connection status; anything else may be transient.
            const next = connectionStatus(cause)
            if (next) yield* status(next)
            yield* Effect.logWarning("failed to load OpenCode provider config", { cause })
            return { _tag: "Failed" as const, connection }
          }),
        ),
      )
    })
    // A load that fails for the connection already in place keeps its last config: dropping it would lift
    // organization policy while personal credentials keep working.
    const fallback = (connection: ActiveConnection): typeof snapshot =>
      IntegrationConnection.key(connection) === IntegrationConnection.key(snapshot.connection)
        ? { ...snapshot, connection }
        : { remote: undefined, connection, organization: undefined, access: undefined }
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
        const server = yield* ConsoleAccess.normalizeServer(ConsoleAccess.server(credential))
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
          const server = yield* ConsoleAccess.normalizeServer(ConsoleAccess.server(credential))
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

    const initial = yield* load()
    snapshot = initial._tag === "Loaded" ? initial.next : fallback(initial.connection)
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
    // Annotated: `apply` re-registers the hooks that call `check`, which would otherwise make inference circular.
    // Loads run outside `loading`, so a slow one never holds up another check. `wait` bounds the load: one still
    // running carries on in `SharedCache`, retries included, for the next check, while the current snapshot stays.
    const check = (maxAge?: Duration.Input, wait?: Duration.Input): Effect.Effect<void> =>
      Effect.gen(function* () {
        const outcome =
          wait === undefined
            ? yield* load(maxAge)
            : Option.getOrUndefined(yield* load(maxAge).pipe(Effect.timeoutOption(wait)))
        if (!outcome) return
        yield* loading.withPermit(
          Effect.gen(function* () {
            // A switch while this load ran makes it stale; the switch's own check applies the new connection.
            const loaded = outcome._tag === "Loaded" ? outcome.next.connection : outcome.connection
            const active = yield* ctx.integration.connection.active("opencode")
            if (IntegrationConnection.key(loaded) !== IntegrationConnection.key(active)) return
            const next = outcome._tag === "Loaded" ? outcome.next : fallback(outcome.connection)
            if (!Equal.equals(snapshot, next)) yield* apply(next)
          }),
        )
      })

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
    // A prompt after the machine slept or the host suspended refreshes stale Console config, and the MCP gateway
    // tokens it carries, before the turn's tool calls run. An unreachable Console delays the prompt by at most
    // 3 seconds; the turn then runs on the config it has.
    yield* ctx.session.hook("prompt", () => check(Duration.minutes(1), Duration.seconds(3)))

    // Console config can change independently of local credential activity, so re-fetch
    // periodically and only rebuild the catalog and search providers when the snapshot differs.
    // Only while connected: a signed-out location runs no timer and no credential lookups. Hosts that suspend
    // between prompts turn the timer off with the `console.poll` server option and rely on the prompt hook.
    const polling = yield* FiberHandle.make<void, never>()
    const poll = Effect.fnUntraced(function* () {
      if (!snapshot.connection || !settings.poll) return yield* FiberHandle.clear(polling)
      yield* FiberHandle.run(polling, Effect.sleep(Duration.minutes(1)).pipe(Effect.andThen(check()), Effect.forever), {
        onlyIfMissing: true,
      })
    })
    // A switch applies only a changed snapshot, so one a prompt already applied doesn't reload MCP servers mid-turn.
    yield* ProviderRefresh.onSwitch("opencode", check().pipe(Effect.andThen(poll())))
    yield* poll()
  }),
})

function connectionStatus(cause: unknown): IntegrationConnection.Status | undefined {
  if (cause instanceof ConsoleAccess.SsoRequiredError)
    return {
      status: "needs_auth",
      message: ConsoleAccess.ssoMessage(cause.organization),
      url: cause.url,
    }
  if (
    cause instanceof ConsoleAccess.SignedOutError ||
    (cause instanceof Integration.AuthorizationError && cause.cause instanceof ConsoleAccess.SignedOutError)
  )
    return { status: "needs_auth", message: ConsoleAccess.signedOutMessage }
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
    accessFingerprint(credential),
  ])
}

function accessFingerprint(credential: Credential.Key | Credential.OAuth) {
  return credential.type === "key" ? SharedCache.fingerprint(credential.key) : undefined
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
      HttpClientRequest.get(`${server}/api/v2/library/skills/${encodeURIComponent(slug)}`).pipe(
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
    } satisfies LibrarySkill
  })
}
