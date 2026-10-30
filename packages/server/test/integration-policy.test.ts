import { expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

it.live("integration policy filters /connect and blocks denied integrations and providers", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-integration-policy-")
    const context = yield* Layer.build(
      createRoutes({
        password: "secret",
        database: { path: ":memory:" },
        models: { fetch: false },
        fs: { filewatcher: false },
        config: {
          directory: tmp.path,
          project: false,
          content: JSON.stringify({
            providers: {
              custom: {
                name: "Configured Custom Provider",
                package: "@opencode/ai/providers/openai-compatible",
                settings: { apiKey: "secret" },
                models: { chat: {} },
              },
            },
            mcp: { servers: { wiki: { type: "remote", url: "http://127.0.0.1:9/mcp" } } },
            policies: [
              { action: "integration.connect", resource: "*", effect: "deny" },
              { action: "integration.connect", resource: "opencode", effect: "allow" },
              { action: "integration.use", resource: "*", effect: "deny" },
              { action: "integration.use", resource: "opencode#org_01M3CAP8H43Z49CER6NT0Y3ZF1", effect: "allow" },
            ],
          }),
        },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (method: "GET" | "POST", route: string, body?: unknown) =>
      Effect.promise(async (signal) => {
        const url = new URL(route, "http://opencode.local")
        url.searchParams.set("location[directory]", tmp.path)
        const response = await handler(
          new Request(url, {
            method,
            headers: {
              authorization: `Basic ${btoa("opencode:secret")}`,
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          }),
        )
        return { status: response.status, body: response.status === 204 ? undefined : await response.json() }
      })

    const integrations = yield* request("GET", "/api/integration")
    expect(integrations.status).toBe(200)
    // MCP sign-ins are outside integration policy; `mcp.use` governs MCP servers.
    const listed: { id: string; metadata?: { source?: string } }[] = integrations.body.data
    expect(listed.filter((integration) => integration.metadata?.source !== "mcp").map((item) => item.id)).toEqual([
      "opencode",
    ])
    const mcp = listed.find((integration) => integration.metadata?.source === "mcp")
    expect(mcp?.id).toStartWith("mcp_")
    const signIn = yield* request("POST", `/api/integration/${encodeURIComponent(mcp?.id ?? "")}/connect/oauth`, {
      methodID: mcp?.id,
    })
    expect(signIn.body?.kind).not.toBe("integration_policy")

    const denied = yield* request("POST", "/api/integration/anthropic/connect/key", { key: "sk-test" })
    expect(denied.status).toBe(400)
    expect(denied.body).toMatchObject({ _tag: "InvalidRequestError", kind: "integration_policy" })
    const credential = yield* request("POST", "/api/credential", {
      integrationID: "anthropic",
      value: { type: "key", key: "sk-test" },
    })
    expect(credential.status).toBe(400)
    expect(credential.body).toMatchObject({ _tag: "InvalidRequestError", kind: "integration_policy" })
    expect((yield* request("GET", "/api/credential")).body.data).toEqual([])
    const wellknown = yield* request("POST", "/api/experimental/integration/wellknown", { url: "https://ai.acme.com" })
    expect(wellknown.body).toMatchObject({ kind: "integration_policy" })

    // The signed-out free tier and the authored provider are both denied.
    expect((yield* request("GET", "/api/provider")).body.data).toEqual([])
  }),
)
