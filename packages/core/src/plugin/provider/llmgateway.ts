import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Deferred, Effect } from "effect"
import type { Server } from "node:http"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { OauthCallbackPage } from "../../oauth/page.js"

const appURL = "https://llmgateway.io"
const browserMethodID = Integration.MethodID.make("browser")
// The dashboard mints a regular API key that the gateway expires or revokes; there is nothing to refresh.
const keyLifetime = 8_640_000_000_000_000

// `org` picks where the dashboard mints the key: "devpass" bills the DevPass subscription, "default" bills credits.
const logins = [
  { id: "llmgateway", org: "devpass" },
  { id: "llmgateway-providers", org: "default" },
] as const

const browser = (integration: { id: string; name: string; org: string }) =>
  ({
    integrationID: integration.id,
    method: { id: browserMethodID, type: "oauth", label: "Log in with browser" },
    authorize: () =>
      Effect.gen(function* () {
        const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex")
        const received = yield* Deferred.make<string, Error>()
        const { createServer } = yield* Effect.promise(() => import("node:http"))
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/callback") {
            response.writeHead(404).end("Not found")
            return
          }
          const key = url.searchParams.get("key")
          const error =
            url.searchParams.get("error") ??
            (url.searchParams.get("state") === state ? undefined : "Invalid authorization response")
          if (error || !key) {
            const message = error ?? "Missing API key"
            Effect.runFork(Deferred.fail(received, new Error(message)))
            response
              .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
              .end(OauthCallbackPage.error(message, { provider: integration.name }))
            return
          }
          Effect.runFork(Deferred.succeed(received, key))
          response
            .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            .end(OauthCallbackPage.success({ provider: integration.name }))
        })
        const port = yield* listen(server)
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
        const params = new URLSearchParams({
          callback: `http://127.0.0.1:${port}/callback`,
          state,
          source: "opencode",
          org: integration.org,
          name: "OpenCode",
        })
        return {
          mode: "auto" as const,
          url: `${appURL}/connect/cli?${params.toString()}`,
          instructions: "Approve OpenCode in your browser, then return here.",
          expiresAt: Date.now() + 5 * 60 * 1000,
          callback: Deferred.await(received).pipe(
            Effect.map((key) =>
              Credential.OAuth.make({
                type: "oauth",
                methodID: browserMethodID,
                access: key,
                refresh: "",
                expires: keyLifetime,
              }),
            ),
          ),
        }
      }),
  }) satisfies IntegrationOAuthMethodRegistration

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
