import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/effect/integration"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Deferred, Effect, Schema, Semaphore, Stream } from "effect"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"
import { Provider } from "../../provider.js"

// Snowflake's built-in public OAuth client for local applications; its "secret" is the client ID itself.
const clientID = "LOCAL_APPLICATION"
const providerID = Provider.ID.make("snowflake-cortex")
const integrationID = Integration.ID.make("snowflake-cortex")
const browserMethodID = Integration.MethodID.make("browser")
const accountPlaceholder = "${SNOWFLAKE_ACCOUNT}"

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
})
type Token = typeof Token.Type

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

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
      label: "Login with Snowflake (browser)",
      form: [
        {
          type: "string",
          key: "account",
          title: "Snowflake account identifier",
          placeholder: "myorg-myaccount",
          required: true,
        },
        {
          type: "string",
          key: "role",
          title: "Snowflake role (optional)",
          placeholder: "PUBLIC",
        },
      ],
    },
    authorize: (answer) =>
      Effect.gen(function* () {
        // Accept the bare identifier or a pasted account URL.
        const account = (typeof answer.account === "string" ? answer.account : "")
          .trim()
          .replace(/^https?:\/\//, "")
          .replace(/\.snowflakecomputing\.com\/?$/, "")
          .replace(/\/+$/, "")
        if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))
        const role = typeof answer.role === "string" ? answer.role.trim() : ""
        const pkce = yield* Effect.promise(generatePKCE)
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
        const code = yield* Deferred.make<string, Error>()
        // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/") {
            response.writeHead(404).end("Not found")
            return
          }
          // Validate state before reading anything else from the callback.
          if (url.searchParams.get("state") !== state) {
            const message = "Invalid OAuth state"
            Effect.runFork(Deferred.fail(code, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.error(message, { provider: "Snowflake" }))
            return
          }
          const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
          const value = url.searchParams.get("code")
          if (error || !value) {
            const message = error ?? "Missing authorization code"
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
        const port = yield* Effect.callback<number, Error>((resume) => {
          server.once("error", (error) => resume(Effect.fail(error)))
          server.listen(0, "127.0.0.1", () => {
            const address = server.address()
            resume(
              address && typeof address === "object"
                ? Effect.succeed(address.port)
                : Effect.fail(new Error("Unable to resolve Snowflake OAuth callback port")),
            )
          })
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const redirect = `http://127.0.0.1:${port}/`
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
          instructions: "Complete Snowflake sign-in in your browser. This window will close automatically.",
          callback: Deferred.await(code).pipe(
            Effect.flatMap((value) =>
              token(
                account,
                { grant_type: "authorization_code", code: value, redirect_uri: redirect, code_verifier: pkce.verifier },
                app,
              ),
            ),
            Effect.flatMap((tokens) => credential(tokens, account)),
          ),
        }
      }),
    refresh: (value) => {
      const account = accountOf(value.metadata)
      if (!account) return Effect.fail(new Error("Snowflake OAuth credential is missing its account"))
      return token(account, { grant_type: "refresh_token", refresh_token: value.refresh }, app).pipe(
        Effect.flatMap((tokens) => credential(tokens, account, value.refresh)),
      )
    },
    label: (value) => accountOf(value.metadata),
  }) satisfies IntegrationOAuthMethodRegistration

export const SnowflakeCortexPlugin = define({
  id: "opencode.provider.snowflake.cortex",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const loading = Semaphore.makeUnsafe(1)
    let account: string | undefined

    const load = Effect.fn("SnowflakeCortexPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      account =
        credential?.type === "oauth" && credential.methodID === browserMethodID
          ? accountOf(credential.metadata)
          : undefined
    })

    yield* ctx.integration.transform((editor) => {
      editor.method.update(browser(ctx.app))
    })
    yield* load()
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(providerID)
      if (!item || !account) return
      // models.dev templates the endpoint on SNOWFLAKE_ACCOUNT; a browser login already knows the account.
      const baseURL = item.provider.settings?.baseURL
      if (typeof baseURL !== "string" || !baseURL.includes(accountPlaceholder)) return
      item.provider.settings = Provider.mergeOverlay(item.provider.settings, {
        baseURL: baseURL.replaceAll(accountPlaceholder, account),
      })
    })
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))),
      Effect.forkScoped({ startImmediately: true }),
    )

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

function issuer(account: string) {
  return `https://${account}.snowflakecomputing.com`
}

function accountOf(metadata: Readonly<Record<string, unknown>> | undefined) {
  return typeof metadata?.account === "string" ? metadata.account : undefined
}

// Snowflake only accepts plain role names inline; anything else must use the encoded scope form.
function scope(role: string) {
  if (!role) return "refresh_token"
  if (/^[-_A-Za-z0-9]+$/.test(role)) return `refresh_token session:role:${role}`
  return `refresh_token session:role-encoded:${encodeURIComponent(role)}`
}

function token(account: string, params: Record<string, string>, app: App.Info) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${issuer(account)}/oauth/token-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${clientID}:${clientID}`).toString("base64")}`,
          "User-Agent": App.useragent(app),
        },
        body: new URLSearchParams({ ...params, client_id: clientID }).toString(),
        signal,
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Snowflake token request failed (${response.status})${detail ? `: ${detail}` : ""}`)
      }
      return Schema.decodeUnknownSync(Token)(await response.json())
    },
    catch: (cause) => cause,
  })
}

function credential(tokens: Token, account: string, currentRefresh?: string) {
  const refresh = tokens.refresh_token ?? currentRefresh
  if (!refresh) {
    return Effect.fail(
      new Error(
        "Snowflake token response did not include refresh_token. Ensure the security integration issues refresh tokens.",
      ),
    )
  }
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID: browserMethodID,
      refresh,
      access: tokens.access_token,
      // Snowflake access tokens default to a ten minute lifetime.
      expires: Date.now() + (tokens.expires_in ?? 600) * 1000,
      metadata: { account },
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
