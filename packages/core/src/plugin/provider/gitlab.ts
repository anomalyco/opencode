import os from "os"
import { App } from "../../app.js"
import { Clock, Deferred, Effect, Exit, Option, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { Server, ServerResponse } from "node:http"
import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
import type { DiscoveredWorkflowModel } from "gitlab-ai-provider"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const providerID = Provider.ID.gitlab
const integrationID = Integration.ID.make("gitlab")
const methodID = Integration.MethodID.make("pkce")
// Instance-owned, trusted GitLab OAuth application for OpenCode. Registered with
// redirect URI http://127.0.0.1:8080/callback on gitlab.com. Self-managed instances
// need their own application; override with GITLAB_OAUTH_CLIENT_ID in that case.
const bundledClientID = "fd180700a8f9c5d5557aca231632dd0611a1135a3bb510a741d5a988a3394fa7"
// Application used by every opencode-gitlab-auth release (and gitlab-ai-provider's
// OPENCODE_GITLAB_AUTH_CLIENT_ID). Refresh tokens stay bound to the issuing
// application, so credentials created by that plugin must refresh with it.
const legacyClientID = "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const gitlabComHost = "gitlab.com"
const oauthScope = "api"
const callbackHost = "127.0.0.1"
const callbackPort = 8080
const redirectURI = `http://${callbackHost}:${callbackPort}/callback`

const Token = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.NonEmptyString,
  expires_in: Schema.optional(Schema.Number),
})
const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.optional(Schema.String), error_description: Schema.optional(Schema.String) }),
  ),
)
const discoveryTimeout = "10 seconds"
// GitLab rotates the refresh token on every refresh, so concurrent refreshes of the same
// credential (e.g. discovery in several Locations plus a request) must share one exchange.
// Settled outcomes are kept briefly: a caller that read the credential just before the
// rotated one was stored would otherwise spend the already-used refresh token again.
const refreshing = new Map<string, { attempt: Deferred.Deferred<Credential.OAuth, TokenError>; until: number }>()
const refreshRetention = 60_000

export const GitLabPlugin = define({
  id: "opencode.provider.gitlab",
  effect: Effect.fn(function* (ctx) {
    const providers = yield* Provider.Service
    const bus = yield* Bus.Service
    const http = yield* HttpClient.HttpClient
    const loading = Semaphore.makeUnsafe(1)
    const loaded: {
      models?: DiscoveredWorkflowModel[]
      connection?: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>
    } = {}

    const load = Effect.fn("GitLabPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      // Like v1, only stored logins drive discovery; ambient GITLAB_TOKEN users are not probed.
      const stored = connection?.type === "credential" ? connection : undefined
      const credential = stored
        ? yield* ctx.integration.connection.resolve(stored).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      if (!stored || !credential) {
        loaded.models = undefined
        loaded.connection = undefined
        return
      }

      const provider = yield* providers.get(providerID)
      // An OAuth login pins the instance it was issued against; prefer it over ambient defaults.
      const instanceUrl =
        credential.type === "oauth" && typeof credential.metadata?.instanceUrl === "string"
          ? credential.metadata.instanceUrl
          : typeof provider?.settings?.instanceUrl === "string"
            ? provider.settings.instanceUrl
            : resolveDefaultInstanceUrl()
      const headers: Record<string, string> =
        credential.type === "oauth"
          ? { Authorization: `Bearer ${credential.access}` }
          : { "PRIVATE-TOKEN": credential.key }
      // The SDK owns project detection, GraphQL discovery, caching and token limits.
      const remote = yield* Effect.tryPromise({
        try: async (signal) => {
          const { discoverWorkflowModels } = await import("gitlab-ai-provider")
          return discoverWorkflowModels(
            {
              instanceUrl,
              getHeaders: () => headers,
              fetch: Object.assign(
                (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
                  fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
                { preconnect: fetch.preconnect },
              ),
            },
            { workingDirectory: ctx.location.directory, cacheKey: stored.id },
          )
        },
        catch: (cause) => cause,
      }).pipe(
        // Discovered models are tied to this connection, so an unresponsive host would
        // otherwise keep the provider hidden and hold the permit for later switches.
        Effect.timeout(discoveryTimeout),
        Effect.catch((cause) =>
          Effect.logWarning("failed to discover GitLab workflow models", { cause }).pipe(Effect.as(undefined)),
        ),
      )
      if (
        IntegrationConnection.key(connection) !==
        IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
      )
        return
      loaded.models = remote?.models
      loaded.connection = connection
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID,
        method: {
          id: methodID,
          type: "oauth",
          label: "Login with GitLab (OAuth)",
          form: Form.Fields.make([instanceUrlField()]),
        },
        label: (value) => new URL(credentialInstanceUrl(value.metadata)).host,
        refresh: (value) => {
          const instanceUrl = credentialInstanceUrl(value.metadata)
          const refreshWith = (clientID: string) =>
            exchange(
              http,
              instanceUrl,
              clientID,
              { grant_type: "refresh_token", refresh_token: value.refresh, redirect_uri: redirectURI },
              describeRefreshFailure,
            ).pipe(Effect.flatMap((tokens) => credential(instanceUrl, clientID, tokens)))
          // A recorded client ID is the application that issued the token; always refresh with it.
          const pinned =
            (typeof value.metadata?.clientID === "string" ? value.metadata.clientID : undefined) ||
            process.env.GITLAB_OAUTH_CLIENT_ID?.trim()
          // Credentials without a recorded client ID may come from opencode-gitlab-auth, whose
          // application differs from the bundled one. A rejected refresh does not consume the
          // refresh token, so retrying with the legacy application is safe.
          return singleFlight(
            `${instanceUrl}\0${value.refresh}`,
            pinned
              ? refreshWith(pinned)
              : refreshWith(bundledClientID).pipe(
                  Effect.catchIf(
                    (error) => error.rejected,
                    () => refreshWith(legacyClientID),
                  ),
                ),
          )
        },
        authorize: (answer) =>
          Effect.gen(function* () {
            // Capture once so the authorize request and the token exchange cannot
            // disagree if the environment changes mid-flow.
            const override = process.env.GITLAB_OAUTH_CLIENT_ID?.trim()
            const clientID = override || bundledClientID
            const instanceUrl = normalizeInstanceUrl(
              typeof answer.instanceUrl === "string" ? answer.instanceUrl : undefined,
            )
            const host = new URL(instanceUrl).host
            if (!override && host !== gitlabComHost)
              return yield* Effect.fail(
                new Error(
                  `The bundled GitLab OAuth application only exists on ${gitlabComHost}. To sign in to ${host},` +
                    ` register an OAuth application there with redirect URI ${redirectURI} and the \`${oauthScope}\`` +
                    ` scope (not marked "Confidential"), then set GITLAB_OAUTH_CLIENT_ID to its application ID.`,
                ),
              )
            const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            const challenge = Buffer.from(
              yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
            ).toString("base64url")
            const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

            const callback = yield* Deferred.make<{ code: string; response: ServerResponse }, Error>()
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", `http://${callbackHost}`)
              if (request.method !== "GET" || url.pathname !== "/callback") {
                response.writeHead(404).end()
                return
              }
              const error = callbackError(url.searchParams, state)
              if (error) {
                response
                  .writeHead(400, { "Content-Type": "text/html" })
                  .end(OauthCallbackPage.error(error, { provider: "GitLab" }))
                Effect.runSync(Deferred.fail(callback, new Error(error)))
                return
              }
              if (!Effect.runSync(Deferred.succeed(callback, { code: url.searchParams.get("code") ?? "", response })))
                response.writeHead(409).end("OAuth callback already received")
            })
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                server.close()
                server.closeAllConnections()
              }),
            )
            yield* listen(server)

            return {
              mode: "auto" as const,
              url: `${instanceUrl}/oauth/authorize?${new URLSearchParams({
                client_id: clientID,
                redirect_uri: redirectURI,
                response_type: "code",
                state,
                scope: oauthScope,
                code_challenge: challenge,
                code_challenge_method: "S256",
              }).toString()}`,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              callback: Effect.gen(function* () {
                const request = yield* Deferred.await(callback)
                const respond = (error?: string) =>
                  Effect.sync(() =>
                    request.response
                      .writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
                      .end(
                        error
                          ? OauthCallbackPage.error(error, { provider: "GitLab" })
                          : OauthCallbackPage.success({ provider: "GitLab" }),
                      ),
                  )
                return yield* exchange(
                  http,
                  instanceUrl,
                  clientID,
                  {
                    grant_type: "authorization_code",
                    code: request.code,
                    redirect_uri: redirectURI,
                    code_verifier: verifier,
                  },
                  describeGrantFailure,
                ).pipe(
                  Effect.flatMap((tokens) => credential(instanceUrl, clientID, tokens)),
                  Effect.tap(() => respond()),
                  Effect.tapError((error) => respond(error.message)),
                  // Bun's server.closeAllConnections() leaves an unanswered callback response pending.
                  Effect.onInterrupt(() => Effect.sync(() => request.response.destroy())),
                )
              }),
            }
          }),
      })
    })

    yield* ctx.provider.transform((editor) => {
      const item = editor.get(providerID)
      if (!item || !loaded.models?.length) return
      editor.add({
        info: item.provider,
        sourceConnection: loaded.connection,
        models: [
          ...item.models.values(),
          ...loaded.models
            .filter((model) => !item.models.has(model.id))
            .map((model) => ({
              ...Model.Info.default(providerID, Model.ID.make(model.id)),
              name: `Agent Platform (${model.name})`,
              package: Provider.aisdk("gitlab-ai-provider"),
              settings: { workflowRef: model.ref },
              capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
              limit: { context: model.context, output: model.output },
            })),
        ],
      })
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)

    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "gitlab-ai-provider") return
        const mod = yield* Effect.promise(() => import("gitlab-ai-provider"))
        evt.sdk = mod.createGitLab({
          ...evt.options,
          instanceUrl:
            typeof evt.options.instanceUrl === "string"
              ? evt.options.instanceUrl
              : (process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"),
          apiKey: typeof evt.options.apiKey === "string" ? evt.options.apiKey : process.env.GITLAB_TOKEN,
          aiGatewayHeaders: {
            "User-Agent": `${App.useragent(ctx.app)} gitlab-ai-provider/${mod.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            "anthropic-beta": "context-1m-2025-08-07",
            ...evt.options.aiGatewayHeaders,
          },
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...evt.options.featureFlags,
          },
        })
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.gitlab) return
        const featureFlags =
          typeof evt.options.featureFlags === "object" && evt.options.featureFlags ? evt.options.featureFlags : {}
        const id = evt.model.modelID ?? evt.model.id
        if (id.startsWith("duo-workflow-")) {
          const gitlab = yield* Effect.promise(() => import("gitlab-ai-provider"))
          const workflowRef =
            typeof evt.model.settings?.workflowRef === "string" ? evt.model.settings.workflowRef : undefined
          const workflowDefinition =
            typeof evt.model.settings?.workflowDefinition === "string"
              ? evt.model.settings.workflowDefinition
              : undefined
          const language = evt.sdk.workflowChat(gitlab.isWorkflowModel(id) ? id : "duo-workflow", {
            featureFlags,
            workflowDefinition,
          })
          if (workflowRef) language.selectedModelRef = workflowRef
          evt.language = language
          return
        }
        evt.language = evt.sdk.agenticChat(id, {
          aiGatewayHeaders: evt.options.aiGatewayHeaders,
          featureFlags,
        })
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

class TokenError extends Error {
  /** GitLab rejected the grant or client, as opposed to a transport or server failure. */
  readonly rejected: boolean

  constructor(message: string, rejected: boolean) {
    super(message)
    this.rejected = rejected
  }
}

function resolveDefaultInstanceUrl() {
  return process.env.GITLAB_INSTANCE_URL ?? "https://gitlab.com"
}

// Keep the path so instances served under a relative URL root (e.g. /gitlab) work.
function normalizeInstanceUrl(value: string | undefined) {
  const url = new URL(value?.trim() || resolveDefaultInstanceUrl())
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

function instanceUrlField() {
  const placeholder = resolveDefaultInstanceUrl()
  return {
    type: "string" as const,
    key: "instanceUrl",
    title: "GitLab instance URL",
    description: "Leave the default to use gitlab.com, or enter your self-managed GitLab URL.",
    placeholder,
    default: placeholder,
    pattern: "^https?://\\S+$",
  }
}

function credentialInstanceUrl(metadata: Readonly<Record<string, unknown>> | undefined) {
  const value = metadata?.instanceUrl
  return typeof value === "string" && value ? value : resolveDefaultInstanceUrl()
}

function describeClient(clientID: string) {
  const source =
    clientID === bundledClientID
      ? "bundled default"
      : clientID === legacyClientID
        ? "opencode-gitlab-auth application"
        : "from GITLAB_OAUTH_CLIENT_ID"
  return `client_id used: ${clientID.slice(0, 12)}... (${source})`
}

// GitLab returns one generic `invalid_grant` for a reused/expired code, a PKCE
// verifier mismatch, a redirect-URI mismatch, and a missing client-secret alike.
// Surface enough context to tell those apart without leaking the verifier/code.
function describeGrantFailure(detail: string, clientID: string) {
  const custom = clientID !== bundledClientID
  const hints = [
    "the authorization code was already used, or came from an older login attempt. Codes are" +
      " single-use and bound to one PKCE verifier, so a stale browser tab or a reloaded callback" +
      " page fails here. Start a completely fresh login.",
    `redirect_uri sent: ${redirectURI} — the application must register this exactly`,
    describeClient(clientID),
  ]
  if (custom) {
    hints.push(
      "confirm that application registers the redirect URI above, grants the `api` scope, and is" +
        ' NOT marked "Confidential" (PKCE requires a public client). Unset GITLAB_OAUTH_CLIENT_ID to' +
        " fall back to the bundled application.",
    )
  }
  return `${detail}\n\nLikely causes:\n- ${hints.join("\n- ")}`
}

function describeRefreshFailure(detail: string, clientID: string) {
  return (
    `${detail}\n\nThe GitLab refresh token was revoked, expired, or issued to a different OAuth` +
    ` application (${describeClient(clientID)}). Sign in to GitLab again.`
  )
}

function exchange(
  http: HttpClient.HttpClient,
  instanceUrl: string,
  clientID: string,
  body: Record<string, string>,
  describe: (detail: string, clientID: string) => string,
) {
  return Effect.gen(function* () {
    const response = yield* http
      .execute(
        HttpClientRequest.post(`${instanceUrl}/oauth/token`).pipe(
          HttpClientRequest.bodyUrlParams({ ...body, client_id: clientID }),
        ),
      )
      .pipe(Effect.mapError(() => new TokenError("GitLab token exchange request failed", false)))
    if (response.status < 200 || response.status >= 300) {
      const parsed = Option.getOrUndefined(decodeError(yield* response.text.pipe(Effect.orElseSucceed(() => ""))))
      const detail = parsed?.error_description || parsed?.error || `HTTP ${response.status}`
      const rejected = parsed?.error === "invalid_grant" || parsed?.error === "invalid_client"
      return yield* Effect.fail(new TokenError(rejected ? describe(detail, clientID) : detail, rejected))
    }
    return yield* HttpClientResponse.schemaBodyJson(Token)(response).pipe(
      Effect.mapError(() => new TokenError("Invalid GitLab token response", false)),
    )
  })
}

function credential(instanceUrl: string, clientID: string, tokens: typeof Token.Type) {
  return Effect.map(Clock.currentTimeMillis, (now) =>
    Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: now + (tokens.expires_in ?? 7200) * 1000,
      metadata: { instanceUrl, clientID },
    }),
  )
}

// Joins refreshes of the same refresh token onto one exchange. Successes and rejections are
// final for that token, so they are retained; transport failures and interrupts are retried.
function singleFlight(key: string, effect: Effect.Effect<Credential.OAuth, TokenError>) {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    refreshing.forEach((entry, entryKey) => {
      if (entry.until < now) refreshing.delete(entryKey)
    })
    const existing = refreshing.get(key)
    if (existing) return yield* Deferred.await(existing.attempt)
    const attempt = Deferred.makeUnsafe<Credential.OAuth, TokenError>()
    refreshing.set(key, { attempt, until: Number.POSITIVE_INFINITY })
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.map(Clock.currentTimeMillis, (settledAt) => {
          const final = Exit.isSuccess(exit) || Option.exists(Exit.findErrorOption(exit), (error) => error.rejected)
          const owned = refreshing.get(key)?.attempt === attempt
          if (owned && final) refreshing.set(key, { attempt, until: settledAt + refreshRetention })
          if (owned && !final) refreshing.delete(key)
          Deferred.doneUnsafe(attempt, exit)
        }),
      ),
    )
  })
}

function callbackError(params: URLSearchParams, state: string) {
  if (params.get("state") !== state) return "Invalid OAuth state"
  if (params.has("error")) return params.get("error_description") || params.get("error") || "Authorization denied"
  return params.get("code")?.trim() ? undefined : "Missing authorization code"
}

// GitLab matches redirect_uri exactly, so the port cannot be ephemeral.
function listen(server: Server) {
  return Effect.callback<void, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(callbackPort, callbackHost, () => {
      server.off("error", onError)
      resume(Effect.void)
    })
  }).pipe(
    Effect.mapError((cause) =>
      "code" in cause && cause.code === "EADDRINUSE"
        ? new Error(
            `GitLab login needs local port ${callbackPort}, but it is already in use. Stop the process using that port and try again.`,
          )
        : cause,
    ),
  )
}
