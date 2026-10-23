import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListResourcesRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Deferred, Effect } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpAuth } from "../../src/mcp/auth"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthPendingProvider, McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

interface OAuthMcpOptions {
  capabilities?: "tools" | "resources"
  oauthMetadata?: boolean
  metadataFailure?: "oauth" | "openid"
  lazyDiscovery?: boolean
  protectedCalls?: boolean
  backgroundChallenge?: boolean
}

function serveOAuthMcp(options: OAuthMcpOptions = {}) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const capabilities = options.capabilities ?? "tools"
      const protocol = new Server(
        { name: "oauth-auto-connect", version: "1.0.0" },
        { capabilities: capabilities === "tools" ? { tools: {} } : { resources: {} } },
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      let listToolsCalls = 0
      let protectedCalls = 0
      let authorizeCalls = 0
      const metadataRequests: string[] = []
      let releaseGet: () => void = () => {}
      const getGate = new Promise<void>((resolve) => {
        releaseGet = resolve
      })
      let requiresAuth = true

      if (capabilities === "tools") {
        protocol.setRequestHandler(ListToolsRequestSchema, () => {
          listToolsCalls++
          return Promise.resolve({ tools: [{ name: "test_tool", inputSchema: { type: "object" } }] })
        })
      }
      if (capabilities === "resources") {
        protocol.setRequestHandler(ListResourcesRequestSchema, () =>
          Promise.resolve({ resources: [{ name: "docs", uri: "docs://readme" }] }),
        )
      }

      await protocol.connect(transport)
      const http = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const origin = url.origin
          const mcpUrl = `${origin}/mcp`

          if (url.pathname === "/authorize") authorizeCalls++
          if (url.pathname.startsWith("/.well-known/")) metadataRequests.push(url.pathname)
          if (
            (options.metadataFailure === "oauth" && url.pathname === "/.well-known/oauth-authorization-server") ||
            (options.metadataFailure === "openid" && url.pathname === "/.well-known/openid-configuration")
          ) {
            return new Response("Unavailable", { status: 503 })
          }
          if (options.oauthMetadata === false && url.pathname.startsWith("/.well-known/")) {
            return new Response("Not found", { status: 404 })
          }
          if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
            return Response.json({
              resource: mcpUrl,
              authorization_servers: [origin],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/.well-known/oauth-protected-resource") {
            return Response.json({
              resource: mcpUrl,
              authorization_servers: [origin],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
              scopes_supported: ["mcp"],
            })
          }
          if (url.pathname === "/register") {
            const metadata = (await request.json()) as Record<string, unknown>
            return Response.json({ ...metadata, client_id: "replacement-client" }, { status: 201 })
          }
          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            if (body.get("code") !== "valid-code") {
              return Response.json(
                { error: "invalid_grant", error_description: "Token exchange failed" },
                { status: 400 },
              )
            }
            return Response.json({ access_token: "replacement-token", token_type: "Bearer" })
          }
          if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })

          if (request.method === "GET") {
            if (options.backgroundChallenge && request.headers.get("authorization") !== "Bearer replacement-token") {
              await getGate
              return new Response("Unauthorized", {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`,
                },
              })
            }
            return new Response(null, { status: 405 })
          }
          if (requiresAuth && request.headers.get("authorization") !== "Bearer replacement-token") {
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`,
              },
            })
          }
          if (options.lazyDiscovery) {
            const message = await request.json()
            if (message.id === undefined) return new Response(null, { status: 202 })
            if (message.method === "tools/call") {
              protectedCalls++
              if (options.protectedCalls && request.headers.get("authorization") !== "Bearer replacement-token") {
                return new Response("Unauthorized", {
                  status: 401,
                  headers: {
                    "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp"`,
                  },
                })
              }
              return Response.json({
                jsonrpc: "2.0",
                id: message.id,
                result: { content: [{ type: "text", text: "synthetic result" }] },
              })
            }
            if (message.method === "initialize")
              return Response.json({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  protocolVersion: "2025-11-25",
                  capabilities: { tools: {} },
                  serverInfo: { name: "lazy-oauth", version: "1.0.0" },
                },
              })
            listToolsCalls++
            return Response.json({
              jsonrpc: "2.0",
              id: message.id,
              result: { tools: [{ name: "test_tool", inputSchema: { type: "object" } }] },
            })
          }
          return transport.handleRequest(request)
        },
      })

      return {
        url: new URL("/mcp", http.url).toString(),
        allowAnonymous: () => {
          requiresAuth = false
        },
        listToolsCalls: () => listToolsCalls,
        protectedCalls: () => protectedCalls,
        authorizeCalls: () => authorizeCalls,
        metadataRequests: () => metadataRequests,
        releaseGet: () => releaseGet(),
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

const remote = (url: string, enabled = true) => ({
  type: "remote" as const,
  url,
  enabled,
})

const stopOAuthCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

mcpTest.instance("first connect to OAuth server shows needs_auth instead of failed", () =>
  Effect.gen(function* () {
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const result = yield* mcp.add("test-oauth", remote(server.url))

    expect((result.status as Record<string, { status: string }>)["test-oauth"]).toEqual({ status: "needs_auth" })
  }),
)

mcpTest.instance("state() generates and persists a new state when none is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-gen",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    expect((yield* auth.get("test-state-gen"))?.oauthState).toBeUndefined()

    const state = yield* Effect.promise(() => provider.state())
    expect(state).toHaveLength(64)
    expect((yield* auth.get("test-state-gen"))?.oauthState).toBe(state)
  }),
)

mcpTest.instance("state() returns existing state when one is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-existing",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    yield* auth.updateOAuthState("test-state-existing", "pre-saved-state-value")
    expect(yield* Effect.promise(() => provider.state())).toBe("pre-saved-state-value")
  }),
)

mcpTest.instance("pending provider does not expose or overwrite existing credentials before commit", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const name = "test-pending-credentials"
    const url = "https://example.com/mcp"
    const provider = new McpOAuthPendingProvider(name, url, {}, { onRedirect: async () => {} }, auth)

    yield* auth.updateClientInfo(name, { clientId: "old-client" }, url)
    yield* auth.updateTokens(name, { accessToken: "old-token" }, url)

    expect(yield* Effect.promise(() => provider.clientInformation())).toBeUndefined()
    expect(yield* Effect.promise(() => provider.tokens())).toBeUndefined()
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")
    expect((yield* auth.get(name))?.clientInfo?.clientId).toBe("old-client")
  }),
)

mcpTest.instance("failed reauthentication preserves existing credentials", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-reauth-failure"

    yield* auth.updateClientInfo(name, { clientId: "dynamic-client", clientSecret: "dynamic-secret" }, server.url)
    yield* auth.updateTokens(name, { accessToken: "working-token" }, server.url)
    yield* mcp.add(name, remote(server.url))
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")

    expect(yield* mcp.finishAuth(name, "invalid-code")).toEqual({
      status: "failed",
      error: "OAuth completion failed: Token exchange failed",
    })
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("working-token")
    expect((yield* auth.get(name))?.clientInfo).toMatchObject({
      clientId: "dynamic-client",
      clientSecret: "dynamic-secret",
    })
  }),
)

mcpTest.instance("successful reauthentication commits replacement credentials", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-reauth-success"

    yield* auth.updateClientInfo(name, { clientId: "old-client" }, server.url)
    yield* auth.updateTokens(name, { accessToken: "old-token" }, server.url)
    yield* mcp.add(name, remote(server.url))
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")

    expect((yield* mcp.finishAuth(name, "valid-code")).status).toBe("connected")
    const entry = yield* auth.get(name)
    expect(entry?.tokens?.accessToken).toBe("replacement-token")
    expect(entry?.clientInfo?.clientId).toBe("replacement-client")
    expect(entry?.serverUrl).toBe(server.url)
  }),
)

mcpTest.instance("auth status only reports credentials stored for the configured server URL", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    yield* mcp.add("test-status-url", remote("https://example.com/mcp", false))
    yield* McpAuth.use.updateTokens("test-status-url", { accessToken: "old-token" }, "https://old.example.com/mcp")

    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("not_authenticated")

    yield* McpAuth.use.updateTokens("test-status-url", { accessToken: "current-token" }, "https://example.com/mcp")
    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("authenticated")

    yield* McpAuth.use.updateTokens(
      "test-status-url",
      { accessToken: "expired-token", expiresAt: 1 },
      "https://example.com/mcp",
    )
    expect(yield* mcp.getAuthStatus("test-status-url")).toBe("expired")
  }),
)

mcpTest.instance("authenticate() connects a public server without OAuth metadata", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ oauthMetadata: false })
    const mcp = yield* MCP.Service
    const name = "test-oauth-connect"
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("needs_auth")

    server.allowAnonymous()
    expect((yield* mcp.authenticate(name)).status).toBe("connected")
    expect((yield* mcp.status())[name]?.status).toBe("connected")
  }),
)

for (const metadataFailure of ["oauth", "openid"] as const) {
  mcpTest.instance(`authenticate() connects without OAuth when ${metadataFailure} discovery returns 503`, () =>
    Effect.gen(function* () {
      yield* stopOAuthCallback
      const server = yield* serveOAuthMcp({ oauthMetadata: false, metadataFailure, lazyDiscovery: true })
      server.allowAnonymous()
      const mcp = yield* MCP.Service
      const name = `test-oauth-discovery-${metadataFailure}-503`
      const added = yield* mcp.add(name, {
        ...remote(server.url),
        ...(metadataFailure === "openid" ? { headers: { Authorization: "Bearer static-test-token" } } : {}),
      })
      expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("connected")
      expect((yield* mcp.authenticate(name)).status).toBe("connected")
      expect((yield* mcp.status())[name]?.status).toBe("connected")
      expect(server.metadataRequests()).toContain(
        metadataFailure === "oauth" ? "/.well-known/oauth-authorization-server" : "/.well-known/openid-configuration",
      )
      expect(server.authorizeCalls()).toBe(0)
    }),
  )
}

mcpTest.instance("authenticate() connects a public resource-only server without listing tools", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ capabilities: "resources", oauthMetadata: false })
    const mcp = yield* MCP.Service
    const name = "test-oauth-resources"
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("needs_auth")

    server.allowAnonymous()
    expect((yield* mcp.authenticate(name)).status).toBe("connected")
    expect(server.listToolsCalls()).toBe(0)
    expect(Object.keys(yield* mcp.resources())).toEqual([`${name}:docs://readme`])
  }),
)

mcpTest.instance("explicit auth starts OAuth after anonymous discovery on a lazy server", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ lazyDiscovery: true })
    server.allowAnonymous()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-lazy-explicit-auth"
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("connected")
    expect(yield* mcp.getAuthStatus(name)).toBe("not_authenticated")
    const started = yield* mcp.startAuth(name)
    expect(started.authorizationUrl).toContain("/authorize")
    const authorization = new URL(started.authorizationUrl)
    expect(authorization.searchParams.get("state")).toBe(started.oauthState)
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorization.searchParams.get("code_challenge")).toBeTruthy()
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
    expect((yield* mcp.finishAuth(name, "valid-code")).status).toBe("connected")
    expect(yield* mcp.getAuthStatus(name)).toBe("authenticated")
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("replacement-token")
    expect(server.listToolsCalls()).toBeGreaterThan(1)
  }),
)

mcpTest.instance("late protected tool401 hides tools until explicit OAuth completes without retry", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveOAuthMcp({ lazyDiscovery: true, protectedCalls: true, backgroundChallenge: true })
    server.allowAnonymous()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const events = yield* EventV2Bridge.Service
    const name = "test-late-auth"
    const toast = yield* Deferred.make<void>()
    const changed = yield* Deferred.make<void>()
    const unsubscribe = yield* events.listen((event) => {
      if (event.type === MCP.ToolsChanged.type) Deferred.doneUnsafe(changed, Effect.void)
      if (event.type === "tui.toast.show") Deferred.doneUnsafe(toast, Effect.void)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const added = yield* mcp.add(name, remote(server.url))
    expect((added.status as Record<string, { status: string }>)[name]?.status).toBe("connected")
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
    const tools = yield* mcp.tools()
    expect(Object.keys(tools)).toContain(`${name}_test_tool`)
    const tool = Object.values(tools)[0]!
    const backgroundError = yield* Deferred.make<void>()
    tool.client.onerror = () => {
      Deferred.doneUnsafe(backgroundError, Effect.void)
    }
    server.releaseGet()
    yield* awaitWithTimeout(Deferred.await(backgroundError), "Missing actual background GET401 error", "2 seconds")
    expect((yield* mcp.status())[name]?.status).toBe("connected")
    expect(Object.keys(yield* mcp.tools())).toHaveLength(1)
    expect(server.protectedCalls()).toBe(0)
    yield* Effect.promise(async () => {
      await expect(tool.client.callTool({ name: tool.def.name, arguments: {} })).rejects.toThrow()
    })
    expect(server.protectedCalls()).toBe(1)
    expect((yield* mcp.status())[name]?.status).toBe("needs_auth")
    expect(Object.keys(yield* mcp.tools())).toHaveLength(0)
    yield* awaitWithTimeout(Deferred.await(changed), "Missing ToolsChanged", "2 seconds")
    yield* awaitWithTimeout(Deferred.await(toast), "Missing authentication toast", "2 seconds")
    expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("/authorize")
    expect((yield* mcp.finishAuth(name, "valid-code")).status).toBe("connected")
    expect((yield* mcp.status())[name]?.status).toBe("connected")
    expect(Object.keys(yield* mcp.tools())).toHaveLength(1)
    expect(server.protectedCalls()).toBe(1)
  }),
)

mcpTest.instance("late tool401 does not offer OAuth when explicitly disabled", () =>
  Effect.gen(function* () {
    const server = yield* serveOAuthMcp({ lazyDiscovery: true, protectedCalls: true })
    server.allowAnonymous()
    const mcp = yield* MCP.Service
    const name = "test-late-no-oauth"
    yield* mcp.add(name, { ...remote(server.url), oauth: false })
    const tool = Object.values(yield* mcp.tools())[0]!
    yield* Effect.promise(async () => {
      await expect(tool.client.callTool({ name: tool.def.name, arguments: {} })).rejects.toThrow()
    })
    expect(server.protectedCalls()).toBe(1)
    expect((yield* mcp.status())[name]?.status).toBe("connected")
    expect(Object.keys(yield* mcp.tools())).toHaveLength(1)
  }),
)
