import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Clock, Deferred, Effect, Option, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"
import { configuredSettings } from "./configured.js"

const providerID = Provider.ID.make("snowflake-cortex")
const integrationID = Integration.ID.make(providerID)
const methodID = Integration.MethodID.make("browser")
const clientID = "LOCAL_APPLICATION"
const accountForm = Form.Fields.make([
  {
    type: "string",
    key: "account",
    title: "Snowflake account",
    placeholder: "myorg-myaccount",
    required: true,
  },
])
const Token = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ message: Schema.optional(Schema.Unknown), error: Schema.optional(Schema.Unknown) }),
  ),
)

export const SnowflakeCortexPlugin = define({
  id: "opencode.provider.snowflake.cortex",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const credentials = yield* Credential.Service
    const integrations = yield* Integration.Service
    const bus = yield* Bus.Service
    const configured = yield* configuredSettings(providerID)
    const account = { value: "" }
    const saved = Effect.gen(function* () {
      const connection = yield* integrations.connection.active(integrationID)
      return connection?.type === "credential" ? yield* credentials.get(connection.id) : undefined
    })
    const token = Effect.fn(function* (account: string, form: Record<string, string>, current?: string) {
      if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))
      const response = yield* http.execute(
        HttpClientRequest.post(`${issuer(account)}/oauth/token-request`).pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/json",
            "User-Agent": App.useragent(ctx.app),
            // Same built-in OAuth client and Basic header as V1; this is not a user password.
            Authorization: `Basic ${Buffer.from(`${clientID}:${clientID}`).toString("base64")}`,
          }),
          HttpClientRequest.bodyUrlParams({ ...form, client_id: clientID }),
        ),
      )
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(
          new Error(`Snowflake token request failed (${response.status}): ${yield* response.text}`),
        )
      const tokens = yield* HttpClientResponse.schemaBodyJson(Token)(response)
      const refresh = tokens.refresh_token || current
      if (!refresh) return yield* Effect.fail(new Error("Snowflake token response did not include refresh_token"))
      return Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: tokens.access_token,
        refresh,
        expires: (yield* Clock.currentTimeMillis) + (tokens.expires_in ?? 600) * 1000,
        metadata: { account },
      })
    })
    const refresh = (value: Credential.OAuth) =>
      token(
        normalizeAccount(value.metadata?.account),
        { grant_type: "refresh_token", refresh_token: value.refresh },
        value.refresh,
      )

    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID,
        method: { type: "key", label: "Paste PAT or bearer token", form: accountForm },
      })
      // SNOWFLAKE_ACCOUNT configures the endpoint; it is not a token.
      editor.method.update({
        integrationID,
        method: { type: "env", names: ["SNOWFLAKE_CORTEX_TOKEN", "SNOWFLAKE_CORTEX_PAT"] },
      })
      editor.method.update({
        integrationID,
        method: {
          id: methodID,
          type: "oauth",
          label: "Login with Snowflake (External Browser)",
          form: [...accountForm, { type: "string", key: "role", title: "Snowflake role (optional)" }],
        },
        refresh,
        label: (value) => normalizeAccount(value.metadata?.account),
        authorize: (answer) =>
          Effect.gen(function* () {
            const account = normalizeAccount(answer.account)
            if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))
            const role = typeof answer.role === "string" ? answer.role.trim() : ""
            const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url")
            const challenge = Buffer.from(
              yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
            ).toString("base64url")
            const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            const code = yield* Deferred.make<string, Error>()
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const { EventEmitter } = yield* Effect.promise(() => import("node:events"))
            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", "http://127.0.0.1")
              if (url.pathname !== "/") {
                response.writeHead(404).end()
                return
              }
              const value = url.searchParams.get("code")
              const error =
                url.searchParams.get("state") !== state
                  ? "Invalid OAuth state"
                  : url.searchParams.get("error_description") ||
                    url.searchParams.get("error") ||
                    (!value ? "Missing authorization code" : undefined)
              Effect.runFork(error ? Deferred.fail(code, new Error(error)) : Deferred.succeed(code, value ?? ""))
              response
                .writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
                .end(
                  error
                    ? OauthCallbackPage.error(error, { provider: "Snowflake" })
                    : OauthCallbackPage.success({ provider: "Snowflake" }),
                )
            })
            yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
            yield* Effect.tryPromise(() => EventEmitter.once(server.listen(0, "127.0.0.1"), "listening"))
            const address = server.address()
            if (!address || typeof address === "string")
              return yield* Effect.fail(new Error("Missing OAuth callback port"))
            const redirect = `http://127.0.0.1:${address.port}/`
            return {
              mode: "auto" as const,
              url: `${issuer(account)}/oauth/authorize?${new URLSearchParams({
                client_id: clientID,
                response_type: "code",
                redirect_uri: redirect,
                state,
                scope: !role
                  ? "refresh_token"
                  : /^[-_A-Za-z0-9]+$/.test(role)
                    ? `refresh_token session:role:${role}`
                    : `refresh_token session:role-encoded:${encodeURIComponent(role)}`,
                code_challenge: challenge,
                code_challenge_method: "S256",
              }).toString()}`,
              instructions: "Complete Snowflake sign-in in your browser.",
              callback: Deferred.await(code).pipe(
                Effect.flatMap((code) =>
                  token(account, {
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: redirect,
                    code_verifier: verifier,
                  }),
                ),
              ),
            }
          }),
      })
    })

    const load = Effect.gen(function* () {
      const value = (yield* saved)?.value
      account.value = normalizeAccount(
        process.env.SNOWFLAKE_ACCOUNT ??
          (value?.type === "key"
            ? (value.configuration?.account ?? value.metadata?.account)
            : value?.metadata?.account) ??
          configured?.account,
      )
    })
    yield* load
    yield* ctx.catalog.transform((catalog) => {
      const item = catalog.provider.get(providerID)
      if (!item) return
      const settings = { ...item.provider.settings, ...configured }
      item.provider.package = "@opencode-ai/ai/providers/openai-compatible"
      item.provider.settings = {
        ...settings,
        provider: providerID,
        baseURL: endpoint(settings.baseURL, account.value),
        ...(typeof settings.token === "string" ? { apiKey: settings.token } : {}),
      }
      for (const model of item.models.values()) {
        model.package = item.provider.package
        model.compatibility = { maxTokensField: "max_completion_tokens", ...model.compatibility }
        if (model.settings?.baseURL !== undefined)
          model.settings.baseURL = endpoint(model.settings.baseURL, account.value)
      }
    })
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => load.pipe(Effect.andThen(ctx.catalog.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.sync(() => {
          // Model resolution already supplies and refreshes stored credentials on each attempt.
          const token = envToken()
          if (token) event.request.headers.set("authorization", `Bearer ${token}`)
          event.request.headers.set("user-agent", App.useragent(ctx.app))
        }),
      { providerID },
    )
    yield* ctx.session.hook(
      "http.response",
      Effect.fn(function* (event) {
        if (event.response.status !== 400) return
        const error = Option.getOrUndefined(decodeError(yield* Effect.promise(() => event.response.clone().text())))
        // oxlint-disable-next-line typescript-eslint/no-base-to-string -- Preserve V1's error-body coercion.
        const message = String(error?.message || error?.error || "")
        if (!message.toLowerCase().includes("conversation complete")) return
        event.response = new Response(
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        )
      }),
      { providerID },
    )
    yield* ctx.session.hook(
      "retry",
      Effect.fn(function* (event) {
        if (event.error.status !== 401 || event.attempt !== 2 || envToken()) return
        const current = yield* saved
        if (current?.value.type !== "oauth" || current.value.methodID !== methodID) return
        yield* credentials.update(current.id, { value: yield* refresh(current.value).pipe(Effect.orDie) })
        event.decision = { retry: true, delay: 0 }
      }),
      { providerID },
    )
  }),
})

function normalizeAccount(value: unknown) {
  if (typeof value !== "string") return ""
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.snowflakecomputing\.com$/i, "")
}

function issuer(account: string) {
  return `https://${account}.snowflakecomputing.com`
}

function endpoint(value: unknown, account: string) {
  const baseURL = typeof value === "string" ? value : `${issuer("${SNOWFLAKE_ACCOUNT}")}/api/v2/cortex/v1`
  return account ? baseURL.replaceAll("${SNOWFLAKE_ACCOUNT}", account) : baseURL
}

function envToken() {
  return process.env.SNOWFLAKE_CORTEX_TOKEN ?? process.env.SNOWFLAKE_CORTEX_PAT
}
