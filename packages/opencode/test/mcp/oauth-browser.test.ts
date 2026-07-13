import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Option } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpAuth } from "../../src/mcp/auth"
import { McpBrowser } from "../../src/mcp/browser"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const browsers = new Map<string, { opened: Deferred.Deferred<string>; fail: boolean }>()

const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) =>
      Effect.gen(function* () {
        const browser = browsers.get(new URL(url).origin)
        if (!browser) return yield* Effect.fail(new Error(`Unexpected browser URL: ${url}`))
        Deferred.doneUnsafe(browser.opened, Effect.succeed(url))
        if (browser.fail) return yield* Effect.fail(new Error("spawn xdg-open ENOENT"))
        yield* Effect.tryPromise({
          try: () => fetch(url).then((response) => response.body?.cancel()),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }),
  }),
)

const mcpTest = testEffect(
  LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node]), [
    [McpBrowser.node, browserLayer],
  ]),
)

const serveOAuthMcp = Effect.acquireRelease(
  Effect.promise(async () => {
    const requests: Array<{ pathname: string; headers: Headers }> = []
    const protocol = new Server({ name: "oauth-browser", version: "1.0.0" }, { capabilities: { tools: {} } })
    protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [] }))
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    await protocol.connect(transport)

    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({ pathname: url.pathname, headers: new Headers(request.headers) })

        if (url.pathname === "/mcp") {
          if (request.headers.get("authorization") === "Bearer test-access-token") {
            return transport.handleRequest(request)
          }
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
            },
          })
        }

        if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
          return Response.json({
            resource: `${url.origin}/mcp`,
            authorization_servers: [url.origin],
            scopes_supported: ["mcp"],
          })
        }

        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: `${url.origin}/token`,
            registration_endpoint: `${url.origin}/register`,
            scopes_supported: ["mcp"],
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          })
        }

        if (url.pathname === "/register") {
          const metadata = await request.json()
          if (!metadata || typeof metadata !== "object") return new Response("Invalid metadata", { status: 400 })
          return Response.json({ ...metadata, client_id: "test-client" }, { status: 201 })
        }

        if (url.pathname === "/authorize") {
          const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
          redirect.searchParams.set("code", "test-code")
          const state = url.searchParams.get("state")
          if (state) redirect.searchParams.set("state", state)
          return Response.redirect(redirect, 302)
        }

        if (url.pathname === "/token") {
          return Response.json({ access_token: "test-access-token", token_type: "Bearer", scope: "mcp" })
        }

        return new Response("Not found", { status: 404 })
      },
    })

    return {
      requests,
      url: new URL("/mcp", http.url).toString(),
      close: async () => {
        await http.stop(true)
        await protocol.close()
      },
    }
  }),
  (server) => Effect.promise(server.close),
)

const withCallbackStop = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

const trackBrowserOpen = (url: string, fail = false) =>
  Effect.gen(function* () {
    const origin = new URL(url).origin
    const opened = yield* Deferred.make<string>()
    browsers.set(origin, { opened, fail })
    yield* Effect.addFinalizer(() => Effect.sync(() => browsers.delete(origin)))
    return opened
  })

const trackBrowserOpenFailed = Effect.gen(function* () {
  const events = yield* EventV2Bridge.Service
  const event = yield* Deferred.make<{ mcpName: string; url: string }>()
  const unsubscribe = yield* events.listen((evt) => {
    if (evt.type === MCP.BrowserOpenFailed.type)
      Deferred.doneUnsafe(event, Effect.succeed(evt.data as { mcpName: string; url: string }))
    return Effect.void
  })
  yield* Effect.addFinalizer(() => unsubscribe)
  return event
})

const addServer = Effect.fnUntraced(function* (name: string, url: string, headers?: Record<string, string>) {
  const mcp = yield* MCP.Service
  const result = yield* mcp.add(name, { type: "remote", url, headers })
  expect(result.status).toMatchObject({ [name]: { status: "needs_auth" } })
  return mcp
})

mcpTest.instance("BrowserOpenFailed event is published when browser launch fails", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp
    yield* trackBrowserOpen(server.url, true)

    const event = yield* trackBrowserOpenFailed
    const mcp = yield* addServer("test-oauth-server", server.url)
    yield* mcp.authenticate("test-oauth-server").pipe(Effect.ignore, Effect.forkScoped)

    const failure = yield* awaitWithTimeout(
      Deferred.await(event),
      "Timed out waiting for BrowserOpenFailed event",
      "5 seconds",
    )

    expect(failure.mcpName).toBe("test-oauth-server")
    expect(failure.url).toStartWith(new URL("/authorize", server.url).toString())
  }),
)

mcpTest.instance("BrowserOpenFailed event is not published when browser launch succeeds", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp

    const opened = yield* trackBrowserOpen(server.url)
    const event = yield* trackBrowserOpenFailed
    const mcp = yield* addServer("test-oauth-server-2", server.url)
    const status = yield* awaitWithTimeout(
      mcp.authenticate("test-oauth-server-2"),
      "Timed out completing OAuth authentication",
      "5 seconds",
    )
    const url = yield* Deferred.await(opened)
    const failure = yield* Deferred.await(event).pipe(Effect.timeoutOption("700 millis"))

    expect(status).toEqual({ status: "connected" })
    expect(failure).toEqual(Option.none())
    expect(new URL(url).origin).toBe(new URL(server.url).origin)
  }),
)

mcpTest.instance("browser launch receives the discovered authorization URL", () =>
  Effect.gen(function* () {
    yield* withCallbackStop
    const server = yield* serveOAuthMcp

    const opened = yield* trackBrowserOpen(server.url)
    const authorization = yield* Deferred.make<string>()
    const mcp = yield* addServer("test-oauth-server-3", server.url, { "X-Custom-Header": "custom-value" })
    const status = yield* awaitWithTimeout(
      mcp.authenticate("test-oauth-server-3", (url) => Deferred.doneUnsafe(authorization, Effect.succeed(url))),
      "Timed out completing OAuth authentication",
      "5 seconds",
    )
    const url = yield* Deferred.await(opened)
    const authorizationUrl = yield* Deferred.await(authorization)

    expect(status).toEqual({ status: "connected" })
    expect(authorizationUrl).toBe(url)
    expect(new URL(url).pathname).toBe("/authorize")
    expect(new URL(url).searchParams.get("client_id")).toBe("test-client")
    expect(
      server.requests.some(
        (request) => request.pathname === "/mcp" && request.headers.get("x-custom-header") === "custom-value",
      ),
    ).toBe(true)
  }),
)
