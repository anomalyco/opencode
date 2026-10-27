import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Deferred, Effect, Option, Schema } from "effect"
import type { Server, ServerResponse } from "node:http"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"

const appURL = "https://llmgateway.io"
const tokenURL = "https://internal.llmgateway.io/public/cli-auth/token"
const browserMethodID = Integration.MethodID.make("browser")
const maxExpiry = 8_640_000_000_000_000

// `org` picks where the dashboard mints the key: "devpass" bills the DevPass subscription, "default" bills credits.
const logins = [
  { id: "llmgateway", org: "devpass" },
  { id: "llmgateway-providers", org: "default" },
] as const

const Token = Schema.Struct({
  api_key: Schema.String.check(Schema.isMinLength(1)),
  expires_at: Schema.NullOr(Schema.String),
})
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(Token))
const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error_description: Schema.optional(Schema.String) })),
)

const browser = (integration: { id: string; name: string; org: string }) =>
  ({
    integrationID: integration.id,
    method: { id: browserMethodID, type: "oauth", label: "Log in with browser" },
    // The dashboard mints a regular API key; once it expires, the user logs in again.
    refresh: (value) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          value.expires > now
            ? Effect.succeed(value)
            : Effect.fail(new Error(`${integration.name} API key expired. Log in with browser again.`)),
        ),
      ),
    authorize: () =>
      Effect.gen(function* () {
        const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
        const challenge = Buffer.from(
          yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
        ).toString("base64url")
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
        const received = yield* Deferred.make<{ code: string; response: ServerResponse }, Error>()
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (request.method !== "GET" || url.pathname !== "/callback") {
            response.writeHead(404).end()
            return
          }
          const code = url.searchParams.get("code")
          const error =
            url.searchParams.get("state") !== state
              ? "Invalid authorization response"
              : (url.searchParams.get("error") ?? (code ? undefined : "Missing authorization code"))
          if (error || !code) {
            const message = error ?? "Missing authorization code"
            response
              .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
              .end(OauthCallbackPage.error(message, { provider: integration.name }))
            Effect.runSync(Deferred.fail(received, new Error(message)))
            return
          }
          if (!Effect.runSync(Deferred.succeed(received, { code, response })))
            response.writeHead(409).end("Authorization callback already received")
        })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            server.close()
            server.closeAllConnections()
          }),
        )
        const port = yield* listen(server)
        const params = new URLSearchParams({
          callback: `http://127.0.0.1:${port}/callback`,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          source: "opencode",
          org: integration.org,
          name: "OpenCode",
        })
        return {
          mode: "auto" as const,
          url: `${appURL}/connect/cli?${params.toString()}`,
          instructions: "Approve OpenCode in your browser, then return here.",
          expiresAt: Date.now() + 5 * 60 * 1000,
          callback: Effect.gen(function* () {
            const request = yield* Deferred.await(received)
            const respond = (error?: string) =>
              Effect.sync(() =>
                request.response
                  .writeHead(error ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" })
                  .end(
                    error
                      ? OauthCallbackPage.error(error, { provider: integration.name })
                      : OauthCallbackPage.success({ provider: integration.name }),
                  ),
              )
            return yield* exchange(request.code, verifier).pipe(
              Effect.tap(() => respond()),
              Effect.tapError((error) => respond(error.message)),
              // Bun's server.closeAllConnections() leaves an unanswered callback response pending.
              Effect.onInterrupt(() => Effect.sync(() => request.response.destroy())),
            )
          }),
        }
      }),
  }) satisfies IntegrationOAuthMethodRegistration

function exchange(code: string, verifier: string) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(tokenURL, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier }),
        }),
      catch: () => new Error("LLM Gateway token exchange request failed"),
    })
    const body = yield* Effect.promise(() => response.text().catch(() => ""))
    if (!response.ok) {
      const detail = Option.getOrUndefined(decodeError(body))?.error_description
      return yield* Effect.fail(
        new Error(detail ? `LLM Gateway login failed: ${detail}` : `LLM Gateway login failed (${response.status})`),
      )
    }
    const token = Option.getOrUndefined(decodeToken(body))
    const expires = token?.expires_at ? Date.parse(token.expires_at) : maxExpiry
    if (!token || !Number.isSafeInteger(expires))
      return yield* Effect.fail(new Error("Invalid LLM Gateway token response"))
    return Credential.OAuth.make({
      type: "oauth",
      methodID: browserMethodID,
      access: token.api_key,
      refresh: "",
      expires,
    })
  })
}

function listen(server: Server) {
  return Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error))
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (!address || typeof address === "string") return resume(Effect.fail(new Error("Missing callback port")))
      resume(Effect.succeed(address.port))
    })
  })
}

export const LLMGatewayPlugin = define({
  id: "opencode.provider.llmgateway",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    const configured = new Set((yield* integrations.list()).map((integration) => integration.id))
    yield* ctx.integration.transform((editor) => {
      for (const item of logins) {
        const integration = editor.get(item.id)
        if (!integration) continue
        editor.method.update(browser({ ...item, name: integration.name }))
      }
    })
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.activation === "disabled") continue
        if (item.provider.package !== "@opencode/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://api.llmgateway.io/v1") continue
        if (!configured.has(Integration.ID.make(item.provider.id))) continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            ...provider.headers,
            "HTTP-Referer": "https://opencode.ai/",
            "X-Title": "opencode",
            "X-Source": "opencode",
          }
        })
      }
    })
  }),
})
