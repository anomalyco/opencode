import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { Context } from "@opencode/plugin/effect/plugin"
import { define } from "@opencode/plugin/effect/plugin"
import { Deferred, Duration, Effect, Option, Schema, Semaphore, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
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
const providerID = Provider.ID.openai
const integrationID = Integration.ID.make("openai")
const methodID = Integration.MethodID.make("chatgpt-token-sharing")
const modelCacheKey = (clientID: string) => `models:${clientID}`
const fallbackModels = new Set([
  "gpt-5.5",
  "gpt-5.5-fast",
  "gpt-5.6-luna",
  "gpt-5.6-luna-fast",
  "gpt-5.6-sol",
  "gpt-5.6-sol-fast",
  "gpt-5.6-terra",
  "gpt-5.6-terra-fast",
  "gpt-6-astra",
  "gpt-6-astra-fast",
])
const nonRetryableSharingCodes = [
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
]
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
const RemoteModels = Schema.Struct({ models: Schema.Array(RemoteModel) })
const decodeCachedModels = Schema.decodeUnknownOption(Schema.Array(RemoteModel))

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
    integrationID,
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
              if (savedID && result.clientID && result.clientID !== savedID)
                return yield* Effect.fail(
                  new Error("ChatGPT returned a different client than this connection. Connect again."),
                )
              const clientID = savedID ?? result.clientID
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
              return credential(tokens, clientID)
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

export const ChatGPTPlugin = define({
  id: "opencode.provider.chatgpt",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const credentials = yield* Credential.Service
    const loading = Semaphore.makeUnsafe(1)
    let chatgpt: Credential.OAuth | undefined
    let available: ReadonlyArray<RemoteModel> | undefined
    let source: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>

    const load = Effect.fn("ChatGPTPlugin.load")(function* () {
      const previous = IntegrationConnection.key(source)
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      chatgpt = credential?.type === "oauth" && credential.methodID === methodID ? credential : undefined
      source = chatgpt ? connection : undefined
      if (previous !== IntegrationConnection.key(source)) {
        const metadata = Option.getOrUndefined(decodeMetadata(chatgpt?.metadata))
        const stored = metadata ? yield* ctx.storage.get(modelCacheKey(metadata.clientID)) : undefined
        available = Option.getOrUndefined(decodeCachedModels(stored))
      }
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update(
        signIn(ctx.app, () => Option.getOrUndefined(decodeMetadata(chatgpt?.metadata))?.clientID, ctx.storage),
      )
    })
    yield* Effect.forEach(
      yield* credentials.list(Integration.ID.make("openai")),
      (entry) => {
        const value = entry.value
        if (value.type !== "oauth" || value.methodID !== Integration.MethodID.make("chatgpt-browser"))
          return Effect.void
        const metadata = Option.getOrUndefined(decodeMetadata(value.metadata))
        if (!metadata) return Effect.void
        return Effect.gen(function* () {
          const saved = yield* ctx.storage.get(modelCacheKey(metadata.clientID))
          if (!Option.isSome(decodeCachedModels(saved)) && metadata.models)
            yield* ctx.storage.set(modelCacheKey(metadata.clientID), metadata.models)
          const { models: _, ...rest } = value.metadata ?? {}
          yield* credentials.update(entry.id, {
            value: Credential.OAuth.make({ ...value, methodID, metadata: rest }),
          })
        })
      },
      { discard: true },
    )
    yield* load()
    yield* ctx.session.hook(
      "retry",
      (event) =>
        Effect.sync(() => {
          if (!chatgpt || !nonRetryableSharingCodes.some((code) => event.error.response?.body.includes(code))) return
          event.decision = { retry: false }
        }),
      { providerID },
    )
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(providerID)
      if (!item) return
      if (!chatgpt || !source) return
      providers.update(providerID, (provider) => {
        provider.settings = Provider.mergeOverlay(provider.settings, {
          baseURL: resource,
          transport: "http",
          compaction: { type: "summary" },
        })
      })
      const updated = providers.get(providerID)
      if (!updated) return
      providers.add({
        info: updated.provider,
        models: available
          ? deriveModels(available, Array.from(item.models.values()))
          : Array.from(item.models.values()).filter((model) => fallbackModels.has(model.id)),
        sourceConnection: source,
      })
    })
    yield* ctx.model.transform((models) => {
      for (const model of models.list(providerID)) {
        models.update(model.providerID, model.id, (draft) => {
          if (!chatgpt) return
          // Token sharing does not support native /responses/compact.
          draft.settings = { ...draft.settings, compaction: { type: "summary" } }
          if (Schema.is(Schema.Struct({ mode: Schema.Literal("pro") }))(draft.body?.reasoning)) {
            draft.enabled = false
            return
          }
          if (available && !available.some((remote) => remote.slug === (draft.modelID ?? draft.id))) {
            draft.enabled = false
            return
          }
          draft.cost = []
        })
      }
    })
    const refreshModels = Effect.fn("ChatGPTPlugin.refreshModels")(function* () {
      const connection = source
      const credential =
        connection?.type === "credential"
          ? (yield* credentials.get(Credential.ID.make(connection.id)))?.value
          : undefined
      if (credential?.type !== "oauth" || credential.methodID !== methodID || credential.expires <= Date.now() + 60_000)
        return
      const metadata = Option.getOrUndefined(decodeMetadata(credential.metadata))
      if (!metadata) return
      const models = yield* fetchModels(credential.access, ctx.app).pipe(
        Effect.timeout(15_000),
        Effect.catch(() => Effect.logWarning("failed to refresh ChatGPT models").pipe(Effect.as(undefined))),
      )
      if (!models) return
      yield* loading.withPermit(
        Effect.gen(function* () {
          if (
            IntegrationConnection.key(connection) !== IntegrationConnection.key(source) ||
            IntegrationConnection.key(connection) !==
              IntegrationConnection.key(yield* ctx.integration.connection.active(integrationID))
          )
            return
          if (JSON.stringify(models) === JSON.stringify(available)) return
          yield* ctx.storage.set(modelCacheKey(metadata.clientID), models)
          available = models
          yield* ctx.provider.reload()
        }),
      )
    })
    const reload = () =>
      loading
        .withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
        .pipe(Effect.andThen(refreshModels().pipe(Effect.forkScoped, Effect.asVoid)))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refreshModels().pipe(Effect.forkScoped)
    yield* Effect.sleep(Duration.minutes(15)).pipe(Effect.andThen(refreshModels), Effect.forever, Effect.forkScoped)
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
    return credential(tokens, metadata.clientID, metadata.scopes)
  })
}

export function fetchModels(token: string, app: App.Info, baseURL = resource) {
  return Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const response = yield* http.execute(
      HttpClientRequest.get(`${baseURL}/models`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("User-Agent", App.useragent(app)),
      ),
    )
    const data = yield* HttpClientResponse.schemaBodyJson(RemoteModels)(response)
    const models = data.models.filter((model) => model.visibility === "list" && model.supported_in_api)
    if (!models.length) return yield* Effect.fail(new Error("No ChatGPT models are available for this account."))
    return models
  })
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

function credential(tokens: TokenResponse, clientID: string, scopes?: ReadonlyArray<string>) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: { clientID, scopes: tokens.scope?.split(" ").filter(Boolean) ?? scopes ?? [] },
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
