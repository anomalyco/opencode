import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { Context } from "@opencode/plugin/effect/plugin"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionRequest } from "@opencode/plugin/effect/session"
import { Deferred, Duration, Effect, Option, Schema, Semaphore, Stream } from "effect"
import type { Server, ServerResponse } from "node:http"
import { App } from "../../app.js"
import { Credential } from "../../credential.js"
import { Bus } from "../../bus.js"
import { Integration } from "../../integration.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { Model } from "../../model.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

// First-time sign-in registers a user-owned client; OpenAI returns its issued client ID on the callback.
const registrationClientID = "dynamic_agent_client"
const agentName = "OpenCode"
const issuer = "https://auth.openai.com"
const tokenURL = `${issuer}/api/accounts/oauth/token`
const resource = "https://api.openai.com/v1"
const tokenSharingScope = "chatgpt.tokens.use.direct"
const nonRetryableSharingCodes = [
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_v2_user_not_eligible",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_v2_client_not_enabled",
  "subscription_sharing_v2_route_not_supported",
  "subscription_sharing_v2_invalid_user",
]
// Stored connections and the legacy credential migration use this ID.
const methodID = Integration.MethodID.make("chatgpt-browser")
// ChatGPT accounts lost gpt-5.4 and gpt-5.4-mini in Codex on 2026-08-31 (replacements: gpt-5.6-terra, gpt-5.6-luna).
const codexAllowed = new Set(["gpt-5.5", "gpt-5.3-codex-spark"])
const codexDisallowed = new Set(["gpt-5.5-pro", "gpt-5.6"])

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  id_token?: string
  expires_in?: number
  scope?: string
}

const RemoteModel = Schema.Struct({
  slug: Schema.String,
  display_name: Schema.String,
  visibility: Schema.String,
  supported_in_api: Schema.Boolean,
  context_window: Schema.Int.check(Schema.isGreaterThan(1)),
  input_modalities: Schema.Array(Schema.String),
  supported_reasoning_levels: Schema.optional(Schema.Array(Schema.Struct({ effort: Schema.String }))),
})
type RemoteModel = typeof RemoteModel.Type
const decodeModels = Schema.decodeUnknownEffect(Schema.Struct({ models: Schema.Array(RemoteModel) }))

// Credential metadata is merged into provider settings; these keys are not OpenAI request options.
const decodeMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    clientID: Schema.String,
    scopes: Schema.optional(Schema.Array(Schema.String)),
    models: Schema.optional(Schema.Array(RemoteModel)),
  }),
)

const signIn = (app: App.Info, savedClientID: () => string | undefined, storage: Context["storage"]) =>
  ({
    integrationID: Integration.ID.make("openai"),
    method: {
      id: methodID,
      type: "oauth",
      label: "Sign in with ChatGPT",
    },
    authorize: () =>
      Effect.gen(function* () {
        const storedHostID = yield* storage.get("chatgpt-agent-host-id")
        const hostID = typeof storedHostID === "string" ? storedHostID : `urn:uuid:${crypto.randomUUID()}`
        if (typeof storedHostID !== "string") yield* storage.set("chatgpt-agent-host-id", hostID)
        const pkce = yield* Effect.promise(generatePKCE)
        const state = randomValue()
        const nonce = randomValue()
        const savedID = savedClientID()
        const received = yield* Deferred.make<{ code: string; clientID?: string; response: ServerResponse }, Error>()
        // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/auth/callback") {
            response.writeHead(404).end("Not found")
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const authorizationCode = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(received, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: "ChatGPT" }))
            return
          }
          if (!authorizationCode || url.searchParams.get("state") !== state) {
            const message = authorizationCode ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(received, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "ChatGPT" }))
            return
          }
          if (
            !Effect.runSync(
              Deferred.succeed(received, {
                code: authorizationCode,
                clientID: url.searchParams.get("client_id") ?? undefined,
                response,
              }),
            )
          )
            response.writeHead(409).end("OAuth callback already received")
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://127.0.0.1:${port}/auth/callback`
        return {
          mode: "auto" as const,
          url: authorizeURL(redirect, pkce, state, nonce, savedID, hostID),
          instructions: "Complete authorization in your browser. This window will close automatically.",
          callback: Effect.gen(function* () {
            const result = yield* Deferred.await(received)
            const respond = (error?: string) =>
              Effect.sync(() =>
                result.response
                  .writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
                  .end(
                    error
                      ? OauthCallbackPage.error(error, { provider: "ChatGPT" })
                      : OauthCallbackPage.success({ provider: "ChatGPT" }),
                  ),
              )
            return yield* Effect.gen(function* () {
              // Reauthorization callbacks may omit the client ID; reuse the one this attempt started with.
              const clientID = result.clientID ?? savedID
              if (!clientID)
                return yield* Effect.fail(new Error("ChatGPT sign-in did not return a client ID. Connect again."))
              const tokens = yield* exchange(result.code, clientID, redirect, pkce, app)
              if (!tokens.scope?.split(" ").includes(tokenSharingScope))
                return yield* Effect.fail(
                  new Error(
                    "ChatGPT sign-in finished without token sharing. Sign in again and allow token sharing, or connect OpenAI with an API key.",
                  ),
                )
              if (!tokens.id_token) return yield* Effect.fail(new Error("ChatGPT sign-in did not return an ID token."))
              yield* verifyIDToken(tokens.id_token, clientID, nonce)
              const models = yield* fetchModels(tokens.access_token, app).pipe(Effect.timeout(15_000))
              return credential(tokens, clientID, undefined, models)
            }).pipe(
              Effect.tap(() => respond()),
              Effect.tapError((error) => respond(error instanceof Error ? error.message : "ChatGPT sign-in failed")),
              Effect.onInterrupt(() => Effect.sync(() => result.response.destroy())),
            )
          }),
        }
      }),
    refresh: (value) => refresh(value, app),
  }) satisfies IntegrationOAuthMethodRegistration

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (!address || typeof address === "string") return resume(Effect.fail(new Error("Missing OAuth callback port")))
      resume(Effect.succeed(address.port))
    })
  })
}

export const OpenAIPlugin = define({
  id: "opencode.provider.openai",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    let chatgpt: Credential.OAuth | undefined
    let available: ReadonlyArray<RemoteModel> | undefined
    let source: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>

    const load = Effect.fn("OpenAIPlugin.load")(function* () {
      const previous = IntegrationConnection.key(source)
      const connection = yield* ctx.integration.connection.active("openai")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      chatgpt = credential?.type === "oauth" && credential.methodID === methodID ? credential : undefined
      source = chatgpt ? connection : undefined
      if (previous !== IntegrationConnection.key(source))
        available = Option.getOrUndefined(decodeMetadata(chatgpt?.metadata))?.models
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update(
        signIn(ctx.app, () => Option.getOrUndefined(decodeMetadata(chatgpt?.metadata))?.clientID, ctx.storage),
      )
    })
    yield* load()
    yield* ctx.session.hook(
      "retry",
      (event) =>
        Effect.sync(() => {
          if (!chatgpt || !nonRetryableSharingCodes.some((code) => event.error.response?.body.includes(code))) return
          event.decision = { retry: false }
        }),
      { providerID: Provider.ID.openai },
    )
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(Provider.ID.openai)
      if (!item) return
      providers.update(item.provider.id, (provider) => {
        provider.settings = Provider.mergeOverlay(provider.settings, {
          // ChatGPT token sharing only supports HTTP streaming.
          transport: chatgpt ? "http" : (provider.settings?.transport ?? "websocket"),
          ...(chatgpt ? { compaction: { type: "summary" } } : {}),
        })
      })
      if (!chatgpt || !available || !source) return
      const updated = providers.get(Provider.ID.openai)
      if (!updated) return
      providers.add({
        info: updated.provider,
        models: deriveModels(available, Array.from(updated.models.values())),
        sourceConnection: source,
      })
    })
    yield* ctx.model.transform((models) => {
      for (const model of models.list(Provider.ID.openai)) {
        models.update(model.providerID, model.id, (draft) => {
          if (!chatgpt) return
          // Token sharing does not support native /responses/compact.
          draft.settings = { ...draft.settings, compaction: { type: "summary" } }
          if (Schema.is(Schema.Struct({ mode: Schema.Literal("pro") }))(draft.body?.reasoning)) {
            draft.enabled = false
            return
          }
          const apiID = draft.modelID ?? draft.id
          if (available) {
            if (!available.some((remote) => remote.slug === apiID)) {
              draft.enabled = false
              return
            }
            draft.cost = []
            return
          }
          // Existing connections without a model snapshot use the old filter until they sign in again.
          const match = apiID.match(/^gpt-(\d+)(?:\.(\d+))?/)
          const major = Number(match?.[1])
          const minor = Number(match?.[2] ?? 0)
          if (
            !codexAllowed.has(apiID) &&
            (codexDisallowed.has(apiID) || !match || !(major > 5 || (major === 5 && minor > 4)))
          ) {
            draft.enabled = false
            return
          }
          draft.cost = []
          // Match Codex CLI so context consumption and subscription usage stay consistent between clients.
          draft.limit = { ...draft.limit, context: 400_000, input: 272_000 }
        })
      }
    })
    // The ChatGPT backend rejects a requested output limit, and OpenAI counts one against rate limits.
    const omitOutputLimit = (evt: SessionRequest) =>
      Effect.sync(() => {
        delete evt.options.maxTokens
      })
    for (const name of ["context", "compaction"] as const)
      yield* ctx.session.hook(name, omitOutputLimit, { providerID: Provider.ID.openai })
    const reload = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("openai")),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.sleep(Duration.minutes(30)).pipe(
      Effect.andThen(
        loading.withPermit(
          Effect.gen(function* () {
            if (!chatgpt || !source || chatgpt.expires <= Date.now() + 60_000) return
            const models = yield* fetchModels(chatgpt.access, ctx.app).pipe(
              Effect.timeout(15_000),
              Effect.catch(() => Effect.logWarning("failed to refresh ChatGPT models").pipe(Effect.as(undefined))),
            )
            if (!models || JSON.stringify(models) === JSON.stringify(available)) return
            if (
              IntegrationConnection.key(source) !==
              IntegrationConnection.key(yield* ctx.integration.connection.active("openai"))
            )
              return
            available = models
            yield* ctx.provider.reload()
          }),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function headers(app: App.Info) {
  return { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": App.useragent(app) }
}

function exchange(code: string, clientID: string, redirect: string, pkce: Pkce, app: App.Info) {
  return request<TokenResponse>(tokenURL, {
    method: "POST",
    headers: headers(app),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientID,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: redirect,
      resource,
    }).toString(),
  })
}

function refresh(value: Credential.OAuth, app: App.Info) {
  return Effect.gen(function* () {
    const metadata = Option.getOrUndefined(decodeMetadata(value.metadata))
    if (!metadata)
      return yield* Effect.fail(new Error("This ChatGPT connection has no registered client ID. Connect again."))
    const tokens = yield* request<TokenResponse>(tokenURL, {
      method: "POST",
      headers: headers(app),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: metadata.clientID,
        refresh_token: value.refresh,
        resource,
      }).toString(),
    })
    return credential(tokens, metadata.clientID, metadata.scopes, metadata.models)
  })
}

export function fetchModels(token: string, app: App.Info, baseURL = resource) {
  return request<unknown>(`${baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": App.useragent(app),
    },
  }).pipe(
    Effect.flatMap(decodeModels),
    Effect.flatMap((response) => {
      const models = response.models.filter((model) => model.visibility === "list" && model.supported_in_api)
      return models.length
        ? Effect.succeed(models)
        : Effect.fail(new Error("No ChatGPT models are available for this account."))
    }),
  )
}

export function deriveModels(remote: ReadonlyArray<RemoteModel>, existing: ReadonlyArray<Model.Info>) {
  const byID = new Map(remote.map((model) => [model.slug, model]))
  const known = new Set(existing.map((model) => model.id))
  return [
    ...existing.flatMap((model) => {
      const found = byID.get(model.modelID)
      return found ? [deriveModel(found, model)] : []
    }),
    ...remote
      .filter((model) => !known.has(Model.ID.make(model.slug)))
      .map((model) => deriveModel(model, Model.Info.default(Provider.ID.openai, Model.ID.make(model.slug)))),
  ]
}

function deriveModel(remote: RemoteModel, previous: Model.Info): Model.Info {
  return {
    ...previous,
    name: previous.id === previous.modelID ? remote.display_name : previous.name,
    package: previous.package ?? "@opencode/ai/providers/openai",
    capabilities: {
      ...previous.capabilities,
      input: remote.input_modalities.filter((modality) => modality === "text" || modality === "image"),
    },
    variants: [
      ...previous.variants.filter((variant) => typeof variant.settings?.reasoningEffort !== "string"),
      ...(remote.supported_reasoning_levels ?? []).map(
        ({ effort }) =>
          previous.variants.find(
            (variant) => variant.id === effort && variant.settings?.reasoningEffort === effort,
          ) ?? { id: Model.VariantID.make(effort), settings: { reasoningEffort: effort } },
      ),
    ],
    limit: { context: remote.context_window, output: previous.limit.output },
  }
}

export function verifyIDToken(
  token: string,
  clientID: string,
  nonce: string,
  jwksURL = new URL(`${issuer}/.well-known/jwks.json`),
) {
  return Effect.tryPromise({
    try: async () => {
      const { createRemoteJWKSet, jwtVerify } = await import("jose")
      const { payload } = await jwtVerify(token, createRemoteJWKSet(jwksURL), {
        issuer,
        audience: clientID,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "nonce", "sub"],
      })
      if (typeof payload.sub !== "string" || !payload.sub.trim()) throw new Error("ID token subject is missing")
      if (payload.nonce !== nonce) throw new Error("ID token nonce does not match this sign-in attempt")
    },
    catch: (cause) => new Error("ChatGPT sign-in returned an invalid ID token.", { cause }),
  })
}

function request<A>(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return response.json() as Promise<A>
    },
    catch: (cause) => cause,
  })
}

function credential(
  tokens: TokenResponse,
  clientID: string,
  scopes?: ReadonlyArray<string>,
  models?: ReadonlyArray<RemoteModel>,
) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: { clientID, scopes: tokens.scope?.split(" ").filter(Boolean) ?? scopes ?? [], models },
  })
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function randomValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

function authorizeURL(
  redirect: string,
  pkce: Pkce,
  state: string,
  nonce: string,
  savedID: string | undefined,
  hostID: string,
) {
  return `${issuer}/api/accounts/authorize?${new URLSearchParams({
    client_id: savedID ?? registrationClientID,
    ...(savedID ? {} : { agent_name_hint: agentName }),
    ext_agent_host_id: hostID,
    // Enable only for user-requested consent retries after OpenAI confirms deployment;
    // ordinary sign-ins must not force reconsent.
    // force_reconsent: "true",
    response_type: "code",
    redirect_uri: redirect,
    scope: `openid profile email offline_access resource.invoke ${tokenSharingScope}`,
    resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: pkce.challenge,
  })}`
}
