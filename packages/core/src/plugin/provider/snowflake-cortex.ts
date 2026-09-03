import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Deferred, Effect, Schema } from "effect"
import type { Server } from "node:http"
import { App } from "../../app.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"

const providerID = Provider.ID.make("snowflake-cortex")
const integrationID = Integration.ID.make("snowflake-cortex")
const browserMethodID = Integration.MethodID.make("browser")
// Snowflake's built-in public OAuth client for local applications. It has no
// secret, so the token endpoint expects the client ID as both Basic credentials.
const clientID = "LOCAL_APPLICATION"
const callbackHost = "127.0.0.1"
// Snowflake OAuth access tokens live 10 minutes unless the response says otherwise.
const defaultTokenLifetime = 600

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
type Token = typeof Token.Type

// Exported for testing: intercepts Cortex-specific request/response quirks.
export function cortexFetch(upstream: FetchLike = fetch) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if ("max_tokens" in body) {
          body.max_completion_tokens = body.max_tokens
          delete body.max_tokens
          init = { ...init, body: JSON.stringify(body) }
        }
      } catch {}
    }

    const response = await upstream(url, init)

    // Cortex returns 400 "conversation complete" as a normal stop condition
    if (response.status === 400) {
      try {
        const errorData = (await response.clone().json()) as Record<string, unknown>
        if (
          String(errorData.message || errorData.error || "")
            .toLowerCase()
            .includes("conversation complete")
        ) {
          return new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "", role: "assistant" } }] }),
            { status: 200, headers: new Headers({ "content-type": "application/json" }) },
          )
        }
      } catch {}
    }

    // Cortex returns role:"" in streaming deltas; the AI SDK schema requires "assistant"
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const stream = new ReadableStream({
        async pull(ctrl) {
          const { done, value } = await reader.read()
          if (done) {
            ctrl.close()
            return
          }
          ctrl.enqueue(
            encoder.encode(decoder.decode(value, { stream: true }).replace(/"role"\s*:\s*""/g, '"role":"assistant"')),
          )
        },
        cancel() {
          reader.cancel()
        },
      })
      return new Response(stream, { headers: response.headers, status: response.status })
    }

    return response
  }
}

const browser = (app: App.Info) =>
  ({
    integrationID,
    method: {
      id: browserMethodID,
      type: "oauth",
      label: "Login with Snowflake (External Browser)",
      form: [
        {
          type: "string",
          key: "account",
          title: "Snowflake account identifier",
          placeholder: "myorg-myaccount",
          required: true,
        },
        { type: "string", key: "role", title: "Snowflake role (optional)", placeholder: "PUBLIC" },
      ],
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const account = normalizeAccount(answer.account)
        if (!account) return yield* Effect.fail(new Error("Snowflake account identifier is required"))
        const role = typeof answer.role === "string" ? answer.role.trim() : ""
        const pkce = yield* Effect.promise(generatePKCE)
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
        const code = yield* Deferred.make<string, Error>()
        // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", `http://${callbackHost}`)
          if (url.pathname !== "/") {
            response.writeHead(404).end("Not found")
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error) {
            Effect.runFork(Deferred.fail(code, new Error(error)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(error, { provider: "Snowflake" }))
            return
          }
          if (!value || url.searchParams.get("state") !== state) {
            const message = value ? "Invalid OAuth state" : "Missing authorization code"
            Effect.runFork(Deferred.fail(code, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "Snowflake" }))
            return
          }
          Effect.runFork(Deferred.succeed(code, value))
          response
            .writeHead(200, { "Content-Type": "text/html" })
            .end(OauthCallbackPage.success({ provider: "Snowflake" }))
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://${callbackHost}:${port}/`
        return {
          mode: "auto" as const,
          url: `${issuer(account)}/oauth/authorize?${new URLSearchParams({
            client_id: clientID,
            response_type: "code",
            redirect_uri: redirect,
            scope: scope(role),
            state,
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
          })}`,
          instructions:
            "Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) =>
              token(
                account,
                {
                  grant_type: "authorization_code",
                  code: value,
                  redirect_uri: redirect,
                  client_id: clientID,
                  code_verifier: pkce.verifier,
                },
                app,
              ),
            ),
            Effect.flatMap((tokens) => credential(tokens, account)),
          ),
        }
      }),
    refresh: (value) => {
      const account = value.metadata?.account
      if (typeof account !== "string") return Effect.fail(new Error("Snowflake credential is missing its account"))
      return token(
        account,
        { grant_type: "refresh_token", refresh_token: value.refresh, client_id: clientID },
        app,
      ).pipe(Effect.flatMap((tokens) => credential(tokens, account, value.refresh)))
    },
    label: (value) => (typeof value.metadata?.account === "string" ? value.metadata.account : undefined),
  }) satisfies IntegrationOAuthMethodRegistration

export const SnowflakeCortexPlugin = define({
  id: "opencode.provider.snowflake.cortex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      editor.method.update(browser(ctx.app))
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        const token =
          process.env.SNOWFLAKE_CORTEX_TOKEN ??
          process.env.SNOWFLAKE_CORTEX_PAT ??
          (typeof evt.options.token === "string" ? evt.options.token : undefined) ??
          (typeof evt.options.apiKey === "string" ? evt.options.apiKey : undefined)
        const upstream = typeof evt.options.fetch === "function" ? (evt.options.fetch as FetchLike) : undefined
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible({
          ...evt.options,
          ...(token ? { apiKey: token } : {}),
          fetch: cortexFetch(upstream) as typeof fetch,
        } as any)
      }),
    )
  }),
})

function normalizeAccount(value: unknown) {
  if (typeof value !== "string") return ""
  return value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.snowflakecomputing\.com\/?$/, "")
    .replace(/\/+$/, "")
}

function issuer(account: string) {
  return `https://${account}.snowflakecomputing.com`
}

// Roles outside Snowflake's unquoted identifier charset must use the encoded scope form.
function scope(role: string) {
  if (!role) return "refresh_token"
  if (/^[-_A-Za-z0-9]+$/.test(role)) return `refresh_token session:role:${role}`
  return `refresh_token session:role-encoded:${encodeURIComponent(role)}`
}

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, callbackHost, () => {
      server.off("error", onError)
      const address = server.address()
      resume(
        address && typeof address === "object"
          ? Effect.succeed(address.port)
          : Effect.fail(new Error("Unable to resolve Snowflake OAuth callback port")),
      )
    })
  })
}

function token(account: string, form: Record<string, string>, app: App.Info) {
  return Effect.tryPromise({
    try: (signal) =>
      fetch(`${issuer(account)}/oauth/token-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": App.useragent(app),
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientID}`).toString("base64")}`,
        },
        body: new URLSearchParams(form).toString(),
        signal,
      }),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(Token)))
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((detail) =>
          Effect.fail(new Error(`Snowflake token request failed (${response.status})${detail ? `: ${detail}` : ""}`)),
        ),
      )
    }),
  )
}

function credential(tokens: Token, account: string, current?: string) {
  const refresh = tokens.refresh_token ?? current
  if (!refresh) {
    return Effect.fail(
      new Error(
        "Snowflake token response did not include refresh_token. Ensure the OAuth security integration issues refresh tokens.",
      ),
    )
  }
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID: browserMethodID,
      access: tokens.access_token,
      refresh,
      expires: Date.now() + (tokens.expires_in ?? defaultTokenLifetime) * 1000,
      // The model resolver projects OAuth metadata into provider settings, so
      // baseURL here replaces the catalog's ${SNOWFLAKE_ACCOUNT} template.
      metadata: { account, baseURL: `${issuer(account)}/api/v2/cortex/v1` },
    }),
  )
}

async function generatePKCE() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)), (byte) => chars[byte % chars.length]).join("")
  const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString(
    "base64url",
  )
  return { verifier, challenge }
}
