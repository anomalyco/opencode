import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect } from "effect"
import type { Scope } from "effect"
import { Credential } from "../../credential"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"
import type { PluginInternal } from "../internal"

const OAUTH_CLIENT_ID = "LOCAL_APPLICATION"
const OAUTH_CALLBACK_HOST = "127.0.0.1"
const OAUTH_CALLBACK_PATH = "/"
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const methodID = Integration.MethodID.make("snowflake-browser")

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

type Pkce = {
  verifier: string
  challenge: string
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
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
    if (!response.ok && response.status === 400) {
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

export function cortexBaseURL(accountId: string) {
  return `https://${accountId}.snowflakecomputing.com/api/v2/cortex/v1`
}

function authHeaders() {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": `opencode/${InstallationVersion}`,
  }
}

function authBasicHeader() {
  return `Basic ${Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_ID}`).toString("base64")}`
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

async function generatePKCE(): Promise<Pkce> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)), (byte) => chars[byte % chars.length]).join(
    "",
  )
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}

function request<A>(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(`Request failed (${response.status})${detail ? `: ${detail}` : ""}`)
      }
      return response.json() as Promise<A>
    },
    catch: (cause) => cause,
  })
}

function exchange(account: string, code: string, redirect: string, pkce: Pkce) {
  return request<TokenResponse>(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      Authorization: authBasicHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  }).pipe(
    Effect.flatMap((token) => {
      if (!token.access_token) return Effect.fail(new Error("Snowflake token response did not include access_token"))
      if (!token.refresh_token) {
        return Effect.fail(
          new Error(
            "Snowflake token response did not include refresh_token. Ensure the integration issues refresh tokens and scope includes refresh_token.",
          ),
        )
      }
      return Effect.succeed(token)
    }),
  )
}

function refresh(value: Pick<Credential.OAuth, "refresh" | "metadata">) {
  const accountId = typeof value.metadata?.accountId === "string" ? value.metadata.accountId : undefined
  if (!accountId) return Effect.fail(new Error("Snowflake OAuth credential is missing accountId metadata"))
  return request<TokenResponse>(`https://${accountId}.snowflakecomputing.com/oauth/token-request`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      Authorization: authBasicHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: OAUTH_CLIENT_ID,
    }).toString(),
  }).pipe(
    Effect.flatMap((token) => {
      if (!token.access_token) return Effect.fail(new Error("Snowflake refresh response did not include access_token"))
      return Effect.succeed(
        Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: token.access_token,
          refresh: token.refresh_token || value.refresh,
          expires: Date.now() + (token.expires_in ?? 600) * 1000,
          metadata: { accountId, baseURL: cortexBaseURL(accountId) },
        }),
      )
    }),
  )
}

function credential(accountId: string, tokens: TokenResponse) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: tokens.access_token,
    refresh: tokens.refresh_token!,
    expires: Date.now() + (tokens.expires_in ?? 600) * 1000,
    metadata: { accountId, baseURL: cortexBaseURL(accountId) },
  })
}

const browser = {
  integrationID: "snowflake-cortex",
  method: {
    id: methodID,
    type: "oauth",
    label: "Login with Snowflake (External Browser)",
    prompts: [
      {
        type: "text" as const,
        key: "account",
        message: "Snowflake Account Identifier",
        placeholder: "myorg-myaccount",
      },
      {
        type: "text" as const,
        key: "role",
        message: "Snowflake Role (optional)",
        placeholder: "PUBLIC",
      },
    ],
  },
  authorize: (inputs) =>
    Effect.gen(function* () {
      const account = normalizeAccount(inputs.account || "")
      if (!account) return yield* Effect.fail(new Error("Snowflake account is required"))
      const role = (inputs.role || "").trim() || undefined
      const pkce = yield* Effect.promise(generatePKCE)
      const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const code = yield* Deferred.make<string, Error>()

      const server = createServer((request, response) => {
        const host = request.headers.host || `${OAUTH_CALLBACK_HOST}:0`
        const url = new URL(request.url ?? "/", `http://${host}`)
        if (url.pathname !== OAUTH_CALLBACK_PATH) {
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

      const redirect = yield* Effect.callback<string, Error>((resume) => {
        server.once("error", (error) => resume(Effect.fail(error)))
        server.listen(0, OAUTH_CALLBACK_HOST, () => {
          const address = server.address()
          if (!address || typeof address === "string") {
            resume(Effect.fail(new Error("Unable to resolve Snowflake OAuth callback port")))
            return
          }
          resume(Effect.succeed(`http://${OAUTH_CALLBACK_HOST}:${address.port}${OAUTH_CALLBACK_PATH}`))
        })
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))

      const scope = oauthScope(role)
      const authorizeURL = `https://${account}.snowflakecomputing.com/oauth/authorize?${new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirect,
        scope,
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      }).toString()}`

      return {
        mode: "auto" as const,
        url: authorizeURL,
        instructions:
          "Complete Snowflake sign-in in your browser. OpenCode will capture the OAuth callback and store the bearer token automatically.",
        callback: Effect.raceFirst(
          Deferred.await(code),
          Effect.sleep(OAUTH_TIMEOUT_MS).pipe(
            Effect.flatMap(() =>
              Effect.fail(new Error("Snowflake OAuth callback timeout - authorization took too long")),
            ),
          ),
        ).pipe(
          Effect.flatMap((value) => exchange(account, value, redirect, pkce)),
          Effect.map((tokens) => credential(account, tokens)),
        ),
      }
    }),
  refresh: (value) => refresh(value),
  label: (credential) =>
    typeof credential.metadata?.accountId === "string" ? String(credential.metadata.accountId) : undefined,
} satisfies IntegrationOAuthMethodRegistration

export const SnowflakeCortexPlugin = define({
  id: "snowflake-cortex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update("snowflake-cortex", (integration) => {
        integration.name = "Snowflake Cortex"
      })
      draft.method.update(browser)
      draft.method.update({
        integrationID: "snowflake-cortex",
        method: { type: "key", label: "Paste PAT or bearer token manually" },
      })
      draft.method.update({
        integrationID: "snowflake-cortex",
        method: {
          type: "env",
          names: ["SNOWFLAKE_CORTEX_TOKEN", "SNOWFLAKE_CORTEX_PAT"],
        },
      })
    })

    yield* ctx.catalog.transform((catalog) => {
      const item = catalog.provider.get(ProviderV2.ID.make("snowflake-cortex"))
      if (!item) return
      catalog.provider.update(item.provider.id, (provider) => {
        provider.integrationID = Integration.ID.make("snowflake-cortex")
      })
    })

    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("snowflake-cortex")) return
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
} satisfies PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>)
