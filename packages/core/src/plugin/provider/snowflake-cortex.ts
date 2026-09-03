import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Deferred, Effect, Schema } from "effect"
import type { Server } from "node:http"
import { App } from "../../app.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

const clientID = "LOCAL_APPLICATION"
const integrationID = Integration.ID.make("snowflake-cortex")
const methodID = Integration.MethodID.make("browser")
const providerID = Provider.ID.make("snowflake-cortex")

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
type Token = typeof Token.Type

type Pkce = {
  verifier: string
  challenge: string
}

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

export function normalizeAccount(input: string) {
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.snowflakecomputing\.com\/?$/, "")
    .replace(/\/+$/, "")
}

export function oauthScope(role: string | undefined) {
  if (!role) return "refresh_token"
  return /^[-_A-Za-z0-9]+$/.test(role)
    ? `refresh_token session:role:${role}`
    : `refresh_token session:role-encoded:${encodeURIComponent(role)}`
}

const browser = (app: App.Info) =>
  ({
    integrationID,
    method: {
      id: methodID,
      type: "oauth",
      label: "Login with Snowflake (External Browser)",
      form: Form.Fields.make([
        {
          type: "string",
          key: "account",
          title: "Snowflake Account Identifier",
          placeholder: "myorg-myaccount",
          required: true,
        },
        {
          type: "string",
          key: "role",
          title: "Snowflake Role (optional)",
          placeholder: "PUBLIC",
        },
      ]),
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        const account = normalizeAccount(typeof answer.account === "string" ? answer.account : "")
        if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))
        const role = typeof answer.role === "string" && answer.role.trim() !== "" ? answer.role.trim() : undefined
        const pkce = yield* Effect.promise(generatePKCE)
        const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
        const code = yield* Deferred.make<string, Error>()
        // Lazy so runtimes without a loopback listener never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://localhost")
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
        const redirect = `http://127.0.0.1:${port}/`
        return {
          mode: "auto" as const,
          url: buildAuthorizeUrl(account, role, redirect, state, pkce),
          instructions: "Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) => exchange(account, value, redirect, pkce, app)),
            Effect.flatMap((tokens) => credential(methodID, tokens, account, role)),
          ),
        }
      }),
    refresh: (value) => refresh(methodID, value, app),
    label: (value) =>
      typeof value.metadata?.account === "string" ? `Snowflake ${value.metadata.account}` : undefined,
  }) satisfies IntegrationOAuthMethodRegistration

export const SnowflakeCortexPlugin = define({
  id: "opencode.provider.snowflake.cortex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.method.update(browser(ctx.app))
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        const connection = yield* ctx.integration.connection
          .active(integrationID)
          .pipe(Effect.orElseSucceed(() => undefined))
        const resolved = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
          : undefined
        const oauthAccess =
          resolved?.type === "oauth" && resolved.methodID === methodID ? resolved.access : undefined
        const token =
          process.env.SNOWFLAKE_CORTEX_TOKEN ??
          process.env.SNOWFLAKE_CORTEX_PAT ??
          oauthAccess ??
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

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (address && typeof address === "object") resume(Effect.succeed(address.port))
      else resume(Effect.fail(new Error("Unable to resolve Snowflake OAuth callback port")))
    })
  })
}

function buildAuthorizeUrl(account: string, role: string | undefined, redirect: string, state: string, pkce: Pkce) {
  const params = new URLSearchParams({
    client_id: clientID,
    response_type: "code",
    redirect_uri: redirect,
    scope: oauthScope(role),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  })
  return `https://${account}.snowflakecomputing.com/oauth/authorize?${params.toString()}`
}

function exchange(account: string, code: string, redirect: string, pkce: Pkce, app: App.Info) {
  return request(
    `https://${account}.snowflakecomputing.com/oauth/token-request`,
    {
      method: "POST",
      headers: { ...headers(app), Authorization: basicHeader() },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: clientID,
        code_verifier: pkce.verifier,
      }).toString(),
    },
  )
}

function refresh(methodID: Integration.MethodID, value: Credential.OAuth, app: App.Info) {
  const account = typeof value.metadata?.account === "string" ? value.metadata.account : undefined
  if (!account) return Effect.fail(new Error("Snowflake OAuth credential is missing account"))
  const role = typeof value.metadata?.role === "string" ? value.metadata.role : undefined
  return request(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
    method: "POST",
    headers: { ...headers(app), Authorization: basicHeader() },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }).toString(),
  }).pipe(Effect.flatMap((tokens) => credential(methodID, tokens, account, role, value.refresh)))
}

function request(url: string, init: RequestInit) {
  return send(url, init).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return decode(response, Token)
      return Effect.promise(() => response.text()).pipe(
        Effect.flatMap((detail) =>
          Effect.fail(new Error(`Snowflake token request failed (${response.status})${detail ? `: ${detail}` : ""}`)),
        ),
      )
    }),
  )
}

function send(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
    catch: (cause) => cause,
  })
}

function decode<S extends Schema.Decoder<unknown>>(response: Response, schema: S) {
  return Effect.promise(() => response.json()).pipe(Effect.map(Schema.decodeUnknownSync(schema)))
}

function credential(
  methodID: Integration.MethodID,
  tokens: Token,
  account: string,
  role: string | undefined,
  currentRefresh?: string,
) {
  const refresh = tokens.refresh_token ?? currentRefresh
  if (!refresh)
    return Effect.fail(
      new Error(
        "Snowflake token response did not include refresh_token. Ensure integration issues refresh tokens and scope includes refresh_token.",
      ),
    )
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID,
      refresh,
      access: tokens.access_token,
      expires: Date.now() + (tokens.expires_in ?? 600) * 1000,
      metadata: { account, ...(role ? { role } : {}) },
    }),
  )
}

function headers(app: App.Info) {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": App.useragent(app),
  }
}

function basicHeader() {
  return `Basic ${Buffer.from(`${clientID}:${clientID}`).toString("base64")}`
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)), (byte) => chars[byte % chars.length]).join("")
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}
