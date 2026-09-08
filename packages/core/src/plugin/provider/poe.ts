import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Deferred, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"

const integrationID = Integration.ID.make("poe")
const methodID = Integration.MethodID.make("browser")
const clientID = "client_728290227fc048cc9262091a1ea197ea"
const Token = Schema.Struct({
  api_key: Schema.NonEmptyString,
  api_key_expires_in: Schema.optional(Schema.NullOr(Schema.Number)),
})

export const PoePlugin = define({
  id: "opencode.provider.poe",
  effect: Effect.fn(function* (ctx) {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "Login with Poe (browser)" },
        // Poe-issued API keys remain usable until expiry, then require another login.
        refresh: (value) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              value.expires > now
                ? Effect.succeed(value)
                : Effect.fail(new Error("Poe API key expired. Log in with Poe again.")),
            ),
          ),
        authorize: () =>
          Effect.gen(function* () {
            const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            const challenge = Buffer.from(
              yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
            ).toString("base64url")
            const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
            const code = yield* Deferred.make<string, Error>()
            const { createServer } = yield* Effect.promise(() => import("node:http"))
            const { EventEmitter } = yield* Effect.promise(() => import("node:events"))
            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", "http://127.0.0.1")
              if (request.method !== "GET" || url.pathname !== "/callback") {
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
                    ? OauthCallbackPage.error(error, { provider: "Poe" })
                    : OauthCallbackPage.success({ provider: "Poe" }),
                )
            })
            yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
            yield* Effect.tryPromise(() => EventEmitter.once(server.listen(0, "127.0.0.1"), "listening"))
            const address = server.address()
            if (!address || typeof address === "string")
              return yield* Effect.fail(new Error("Missing OAuth callback port"))
            const redirect = `http://127.0.0.1:${address.port}/callback`
            return {
              mode: "auto" as const,
              url: `https://poe.com/oauth/authorize?${new URLSearchParams({
                response_type: "code",
                client_id: clientID,
                redirect_uri: redirect,
                scope: "apikey:create",
                code_challenge: challenge,
                code_challenge_method: "S256",
                state,
              }).toString()}`,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              callback: Effect.gen(function* () {
                const value = yield* Deferred.await(code)
                const token = yield* http
                  .execute(
                    HttpClientRequest.post("https://api.poe.com/token").pipe(
                      HttpClientRequest.bodyUrlParams({
                        grant_type: "authorization_code",
                        client_id: clientID,
                        code: value,
                        redirect_uri: redirect,
                        code_verifier: verifier,
                      }),
                    ),
                  )
                  .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)))
                return Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: token.api_key,
                  refresh: "",
                  expires:
                    token.api_key_expires_in == null
                      ? Number.MAX_SAFE_INTEGER
                      : (yield* Clock.currentTimeMillis) + token.api_key_expires_in * 1000,
                })
              }),
            }
          }),
      })
    })
  }),
})
