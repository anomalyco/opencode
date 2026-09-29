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
import { SessionAffinity } from "../../session/affinity.js"
import type { PluginInternal } from "../internal.js"

const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
const issuer = "https://auth.openai.com"
const callbackPort = 1455
const callbackFallbackPort = 1457
const callbackBindAttempts = 10
const callbackBindRetryDelay = 200
const pollingSafetyMargin = 3000
const codexBaseURL = "https://chatgpt.com/backend-api/codex"
const sharingClientID = "dynamic_agent_client"
const sharingTokenURL = `${issuer}/api/accounts/oauth/token`
const sharingResource = "https://api.openai.com/v1"
const sharingScope = "chatgpt.tokens.use.direct"
const sharingMethodID = Integration.MethodID.make("chatgpt-token-sharing")
const nonRetryableSharingCodes = [
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_v2_user_not_eligible",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_v2_client_not_enabled",
  "subscription_sharing_v2_route_not_supported",
  "subscription_sharing_v2_invalid_user",
]
const browserMethodID = Integration.MethodID.make("chatgpt-browser")
const headlessMethodID = Integration.MethodID.make("chatgpt-headless")
// ChatGPT accounts lost gpt-5.4 and gpt-5.4-mini in Codex on 2026-08-31 (replacements: gpt-5.6-terra, gpt-5.6-luna).
const codexAllowed = new Set(["gpt-5.5", "gpt-5.3-codex-spark"])
const codexDisallowed = new Set(["gpt-5.5-pro", "gpt-5.6"])

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type SharingTokenResponse = {
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
const decodeSharingMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    clientID: Schema.String,
    scopes: Schema.optional(Schema.Array(Schema.String)),
    models: Schema.optional(Schema.Array(RemoteModel)),
  }),
)

const Claims = Schema.fromJsonString(
  Schema.Struct({
    chatgpt_account_id: Schema.optional(Schema.String),
    organizations: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
    "https://api.openai.com/auth": Schema.optional(
      Schema.Struct({ chatgpt_account_id: Schema.optional(Schema.String) }),
    ),
  }),
)
const decodeClaims = Schema.decodeUnknownOption(Claims)

const browser = (app: App.Info) =>
  ({
    integrationID: Integration.ID.make("openai"),
    method: {
      id: browserMethodID,
      type: "oauth",
      label: "ChatGPT Pro/Plus (browser)",
    },
    authorize: () =>
      Effect.gen(function* () {
        const pkce = yield* Effect.promise(generatePKCE)
        const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
        const code = yield* Deferred.make<string, Error>()
        // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://localhost")
          if (url.pathname !== "/auth/callback") {
            response.writeHead(404).end("Not found")
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(code, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: "ChatGPT" }))
            return
          }
          if (!value || url.searchParams.get("state") !== state) {
            const message = value ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(code, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "ChatGPT" }))
            return
          }
          Effect.runFork(Deferred.succeed(code, value))
          response
            .writeHead(200, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.success({ provider: "ChatGPT" }))
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://localhost:${port}/auth/callback`
        return {
          mode: "auto" as const,
          url: authorizeURL(redirect, pkce, state),
          instructions: "Complete authorization in your browser. This window will close automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) => exchange(value, redirect, pkce, app)),
            Effect.map((tokens) => credential(browserMethodID, tokens)),
          ),
        }
      }),
    refresh: (value) => refresh(browserMethodID, value, app),
  }) satisfies IntegrationOAuthMethodRegistration

function listen(server: Server) {
  return bind(server, callbackPort).pipe(
    Effect.as(callbackPort),
    Effect.catchIf(addressInUse, () =>
      cancel(callbackPort).pipe(
        Effect.ignore,
        Effect.andThen(Effect.sleep(callbackBindRetryDelay)),
        Effect.andThen(bindWithRetry(server, callbackPort, callbackBindAttempts - 1)),
        Effect.as(callbackPort),
        Effect.catchIf(addressInUse, () =>
          bindWithRetry(server, callbackFallbackPort, callbackBindAttempts).pipe(
            Effect.as(callbackFallbackPort),
            Effect.catchIf(addressInUse, () =>
              Effect.fail(
                new Error(
                  `OpenAI browser login needs local port ${callbackPort} or ${callbackFallbackPort}, but both are already in use. Stop the processes using those ports or choose ChatGPT Pro/Plus (headless), then try again.`,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

function bindWithRetry(server: Server, port: number, attempts: number): Effect.Effect<void, Error> {
  return bind(server, port).pipe(
    Effect.catchIf(
      (error) => addressInUse(error) && attempts > 1,
      () => Effect.sleep(callbackBindRetryDelay).pipe(Effect.andThen(bindWithRetry(server, port, attempts - 1))),
    ),
  )
}

function bind(server: Server, port: number) {
  return Effect.callback<void, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(port, "localhost", () => {
      server.off("error", onError)
      resume(Effect.void)
    })
  })
}

function cancel(port: number) {
  return Effect.tryPromise({
    try: (signal) =>
      fetch(`http://localhost:${port}/cancel`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
      }),
    catch: (cause) => cause,
  })
}

function addressInUse(error: Error) {
  return "code" in error && error.code === "EADDRINUSE"
}

const headless = (app: App.Info) =>
  ({
    integrationID: Integration.ID.make("openai"),
    method: {
      id: headlessMethodID,
      type: "oauth",
      label: "ChatGPT Pro/Plus (headless)",
    },
    authorize: () =>
      Effect.gen(function* () {
        const device = yield* request<{ device_auth_id: string; user_code: string; interval: string }>(
          `${issuer}/api/accounts/deviceauth/usercode`,
          {
            method: "POST",
            headers: headers("application/json", app),
            body: JSON.stringify({ client_id: clientID }),
          },
        )
        const interval = Math.max(Number.parseInt(device.interval) || 5, 1) * 1000
        return {
          mode: "auto" as const,
          url: `${issuer}/codex/device`,
          instructions: `Enter code: ${device.user_code}`,
          callback: Effect.gen(function* () {
            while (true) {
              const response = yield* Effect.tryPromise({
                try: (signal) =>
                  fetch(`${issuer}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: headers("application/json", app),
                    body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
                    signal,
                  }),
                catch: (cause) => cause,
              })
              if (response.ok) {
                const data = (yield* Effect.promise(() => response.json())) as {
                  authorization_code: string
                  code_verifier: string
                }
                return credential(
                  headlessMethodID,
                  yield* exchange(
                    data.authorization_code,
                    `${issuer}/deviceauth/callback`,
                    { verifier: data.code_verifier, challenge: "" },
                    app,
                  ),
                )
              }
              if (response.status !== 403 && response.status !== 404) {
                return yield* Effect.fail(new Error(`Device authorization failed: ${response.status}`))
              }
              yield* Effect.sleep(interval + pollingSafetyMargin)
            }
          }),
        }
      }),
    refresh: (value) => refresh(headlessMethodID, value, app),
  }) satisfies IntegrationOAuthMethodRegistration

const signIn = (app: App.Info, savedClientID: () => string | undefined, storage: Context["storage"]) =>
  ({
    integrationID: Integration.ID.make("openai"),
    method: { id: sharingMethodID, type: "oauth", label: "Sign in with ChatGPT" },
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
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/auth/callback") {
            response.writeHead(404).end("Not found")
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const code = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(received, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: "ChatGPT" }))
            return
          }
          if (!code || url.searchParams.get("state") !== state) {
            const message = code ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(received, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "ChatGPT" }))
            return
          }
          if (
            !Effect.runSync(
              Deferred.succeed(received, { code, clientID: url.searchParams.get("client_id") ?? undefined, response }),
            )
          )
            response.writeHead(409).end("OAuth callback already received")
        })
        const port = yield* Effect.callback<number, Error>((resume) => {
          const onError = (error: Error) => resume(Effect.fail(error))
          server.once("error", onError)
          server.listen(0, "127.0.0.1", () => {
            server.off("error", onError)
            const address = server.address()
            if (!address || typeof address === "string")
              return resume(Effect.fail(new Error("Missing OAuth callback port")))
            resume(Effect.succeed(address.port))
          })
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://127.0.0.1:${port}/auth/callback`
        return {
          mode: "auto" as const,
          url: sharingAuthorizeURL(redirect, pkce, state, nonce, savedID, hostID),
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
              const clientID = result.clientID ?? savedID
              if (!clientID)
                return yield* Effect.fail(new Error("ChatGPT sign-in did not return a client ID. Connect again."))
              const tokens = yield* sharingExchange(result.code, clientID, redirect, pkce, app)
              if (!tokens.scope?.split(" ").includes(sharingScope))
                return yield* Effect.fail(
                  new Error(
                    "ChatGPT sign-in finished without token sharing. Sign in again and allow token sharing, or connect OpenAI with an API key.",
                  ),
                )
              if (!tokens.id_token) return yield* Effect.fail(new Error("ChatGPT sign-in did not return an ID token."))
              yield* verifySharingIDToken(tokens.id_token, clientID, nonce)
              return sharingCredential(
                tokens,
                clientID,
                undefined,
                yield* fetchSharingModels(tokens.access_token, app).pipe(Effect.timeout(15_000)),
              )
            }).pipe(
              Effect.tap(() => respond()),
              Effect.tapError((error) => respond(error instanceof Error ? error.message : "ChatGPT sign-in failed")),
              Effect.onInterrupt(() => Effect.sync(() => result.response.destroy())),
            )
          }),
        }
      }),
    refresh: (value) => sharingRefresh(value, app),
  }) satisfies IntegrationOAuthMethodRegistration

export const OpenAIPlugin = define({
  id: "opencode.provider.openai",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    let chatgpt: Credential.OAuth | undefined
    let sharing: Credential.OAuth | undefined
    let available: ReadonlyArray<RemoteModel> | undefined
    let source: Effect.Success<ReturnType<typeof ctx.integration.connection.active>>

    const load = Effect.fn("OpenAIPlugin.load")(function* () {
      const previous = IntegrationConnection.key(source)
      const connection = yield* ctx.integration.connection.active("openai")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      chatgpt =
        credential?.type === "oauth" &&
        (credential.methodID === browserMethodID || credential.methodID === headlessMethodID)
          ? credential
          : undefined
      sharing = credential?.type === "oauth" && credential.methodID === sharingMethodID ? credential : undefined
      source = sharing ? connection : undefined
      if (previous !== IntegrationConnection.key(source))
        available = Option.getOrUndefined(decodeSharingMetadata(sharing?.metadata))?.models
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update(
        signIn(ctx.app, () => Option.getOrUndefined(decodeSharingMetadata(sharing?.metadata))?.clientID, ctx.storage),
      )
      editor.method.update(browser(ctx.app))
      editor.method.update(headless(ctx.app))
    })
    yield* load()
    yield* ctx.session.hook(
      "retry",
      (event) =>
        Effect.sync(() => {
          if (!sharing || !nonRetryableSharingCodes.some((code) => event.error.response?.body.includes(code))) return
          event.decision = { retry: false }
        }),
      { providerID: Provider.ID.openai },
    )
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(Provider.ID.openai)
      if (!item) return
      const account = chatgpt?.metadata?.accountID
      providers.update(item.provider.id, (provider) => {
        provider.settings = Provider.mergeOverlay(provider.settings, {
          transport: sharing ? "http" : (provider.settings?.transport ?? "websocket"),
          ...(chatgpt ? { baseURL: codexBaseURL } : {}),
          ...(sharing ? { compaction: { type: "summary" } } : {}),
        })
        if (!chatgpt) return
        provider.headers = Provider.mergeHeaders(provider.headers, {
          originator: "opencode",
          "x-codex-beta-features": "remote_compaction_v2",
          ...(typeof account === "string" ? { "chatgpt-account-id": account } : {}),
        })
      })
      if (!sharing || !available || !source) return
      const updated = providers.get(Provider.ID.openai)
      if (!updated) return
      providers.add({
        info: updated.provider,
        models: deriveSharingModels(available, Array.from(updated.models.values())),
        sourceConnection: source,
      })
    })
    yield* ctx.model.transform((models) => {
      for (const model of models.list(Provider.ID.openai)) {
        // ChatGPT-plan tokens only authorize codex-eligible models, and the
        // subscription covers usage, so hide the rest and zero the cost.
        models.update(model.providerID, model.id, (draft) => {
          if (sharing) {
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
            // A connection saved before model discovery has a catalog fallback until reauthorization.
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
            draft.limit = { ...draft.limit, context: 400_000, input: 272_000 }
            return
          }
          if (!chatgpt) return
          if (Schema.is(Schema.Struct({ mode: Schema.Literal("pro") }))(draft.body?.reasoning)) {
            draft.enabled = false
            return
          }
          const apiID = draft.modelID ?? draft.id
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
    yield* ctx.session.hook(
      "model.request",
      (evt) =>
        Effect.gen(function* () {
          if (!chatgpt) return
          if (evt.baseURL && URL.canParse(evt.baseURL) && new URL(evt.baseURL).origin === "https://api.openai.com")
            evt.baseURL = codexBaseURL
          const session = yield* ctx.session
            .get({ sessionID: evt.sessionID })
            .pipe(Effect.orElseSucceed(() => undefined))
          evt.headers.originator = "opencode"
          // ChatGPT routes its prompt cache on this header, so children share the parent's.
          evt.headers["session-id"] = session ? SessionAffinity.get(session) : evt.sessionID
        }),
      { providerID: Provider.ID.openai },
    )
    // The ChatGPT backend rejects a requested output limit, and OpenAI counts one against rate limits.
    const omitOutputLimit = (evt: SessionRequest) =>
      Effect.sync(() => {
        if (sharing) return
        delete evt.options.maxTokens
      })
    for (const name of ["context", "compaction"] as const)
      yield* ctx.session.hook(name, omitOutputLimit, { providerID: Provider.ID.openai })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.provider.reload())))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("openai")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.sleep(Duration.minutes(30)).pipe(
      Effect.andThen(
        loading.withPermit(
          Effect.gen(function* () {
            if (!sharing || !source || sharing.expires <= Date.now() + 60_000) return
            const models = yield* fetchSharingModels(sharing.access, ctx.app).pipe(
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

function headers(contentType: string, app: App.Info) {
  return { "Content-Type": contentType, "User-Agent": App.useragent(app) }
}

function exchange(code: string, redirect: string, pkce: Pkce, app: App.Info) {
  return request<TokenResponse>(`${issuer}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded", app),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
}

function refresh(methodID: Integration.MethodID, value: Pick<Credential.OAuth, "refresh" | "metadata">, app: App.Info) {
  return request<TokenResponse>(`${issuer}/oauth/token`, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded", app),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }).toString(),
  }).pipe(
    Effect.map((tokens) => {
      const next = credential(methodID, tokens)
      return Credential.OAuth.make({ ...next, metadata: next.metadata ?? value.metadata })
    }),
  )
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

function credential(methodID: Integration.MethodID, tokens: TokenResponse) {
  const accountID = extractAccountID(tokens)
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: accountID ? { accountID } : undefined,
  })
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

function authorizeURL(redirect: string, pkce: Pkce, state: string) {
  return `${issuer}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientID,
    redirect_uri: redirect,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })}`
}

function extractAccountID(tokens: TokenResponse) {
  return claim(tokens.id_token) ?? claim(tokens.access_token)
}

function claim(token: string) {
  const part = token.split(".")[1]
  if (!part) return
  const claims = Option.getOrUndefined(decodeClaims(Buffer.from(part, "base64url").toString()))
  if (!claims) return
  return (
    claims.chatgpt_account_id ??
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.organizations?.[0]?.id
  )
}

function sharingExchange(code: string, clientID: string, redirect: string, pkce: Pkce, app: App.Info) {
  return request<SharingTokenResponse>(sharingTokenURL, {
    method: "POST",
    headers: headers("application/x-www-form-urlencoded", app),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientID,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: redirect,
      resource: sharingResource,
    }).toString(),
  }).pipe(Effect.mapError((cause) => new Error(`ChatGPT token exchange failed: ${String(cause)}`, { cause })))
}

function sharingRefresh(value: Credential.OAuth, app: App.Info) {
  return Effect.gen(function* () {
    const metadata = Option.getOrUndefined(decodeSharingMetadata(value.metadata))
    if (!metadata)
      return yield* Effect.fail(new Error("This ChatGPT connection has no registered client ID. Connect again."))
    const tokens = yield* request<SharingTokenResponse>(sharingTokenURL, {
      method: "POST",
      headers: headers("application/x-www-form-urlencoded", app),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: metadata.clientID,
        refresh_token: value.refresh,
        resource: sharingResource,
      }).toString(),
    })
    return sharingCredential(tokens, metadata.clientID, metadata.scopes, metadata.models)
  })
}

export function fetchSharingModels(token: string, app: App.Info, baseURL = sharingResource) {
  return request<unknown>(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": App.useragent(app) },
  }).pipe(
    Effect.mapError((cause) => new Error(`ChatGPT model discovery failed: ${String(cause)}`, { cause })),
    Effect.flatMap(decodeModels),
    Effect.flatMap((response) => {
      const models = response.models.filter((model) => model.visibility === "list" && model.supported_in_api)
      return models.length
        ? Effect.succeed(models)
        : Effect.fail(new Error("No ChatGPT models are available for this account."))
    }),
  )
}

export function deriveSharingModels(remote: ReadonlyArray<RemoteModel>, existing: ReadonlyArray<Model.Info>) {
  const byID = new Map(remote.map((model) => [model.slug, model]))
  const known = new Set(existing.map((model) => model.id))
  const derive = (item: RemoteModel, previous: Model.Info): Model.Info => ({
    ...previous,
    name: previous.id === previous.modelID ? item.display_name : previous.name,
    package: previous.package ?? "@opencode/ai/providers/openai",
    capabilities: {
      ...previous.capabilities,
      input: item.input_modalities.filter((modality) => modality === "text" || modality === "image"),
    },
    variants: [
      ...previous.variants.filter((variant) => typeof variant.settings?.reasoningEffort !== "string"),
      ...(item.supported_reasoning_levels ?? []).map(
        ({ effort }) =>
          previous.variants.find(
            (variant) => variant.id === effort && variant.settings?.reasoningEffort === effort,
          ) ?? { id: Model.VariantID.make(effort), settings: { reasoningEffort: effort } },
      ),
    ],
    limit: { context: item.context_window, output: previous.limit.output },
  })
  return [
    ...existing.flatMap((model) => {
      const found = byID.get(model.modelID)
      return found ? [derive(found, model)] : []
    }),
    ...remote
      .filter((model) => !known.has(Model.ID.make(model.slug)))
      .map((model) => derive(model, Model.Info.default(Provider.ID.openai, Model.ID.make(model.slug)))),
  ]
}

export function verifySharingIDToken(
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

function sharingCredential(
  tokens: SharingTokenResponse,
  clientID: string,
  scopes?: ReadonlyArray<string>,
  models?: ReadonlyArray<RemoteModel>,
) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: sharingMethodID,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    metadata: { clientID, scopes: tokens.scope?.split(" ").filter(Boolean) ?? scopes ?? [], models },
  })
}

function randomValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function sharingAuthorizeURL(
  redirect: string,
  pkce: Pkce,
  state: string,
  nonce: string,
  savedID: string | undefined,
  hostID: string,
) {
  return `${issuer}/api/accounts/authorize?${new URLSearchParams({
    client_id: savedID ?? sharingClientID,
    ...(savedID ? {} : { agent_name_hint: "OpenCode" }),
    ext_agent_host_id: hostID,
    response_type: "code",
    redirect_uri: redirect,
    scope: `openid profile email offline_access resource.invoke ${sharingScope}`,
    resource: sharingResource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: pkce.challenge,
  })}`
}
