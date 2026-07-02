import { expect, mock, beforeEach } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

// Mock UnauthorizedError to match the SDK's class
class MockUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message ?? "Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []

// Controls whether the mock transport simulates a 401 that triggers the SDK
// auth flow (which calls provider.state()) or a simple UnauthorizedError.
let simulateAuthFlow = true
let connectSucceedsImmediately = false
let serverCapabilities: { tools?: object; resources?: object } = { tools: {} }
let listToolsCalls = 0
let finishAuthFails = false
let finishAuthStoresCredentials = false

// Mock the transport constructors to simulate OAuth auto-auth on 401
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    authProvider:
      | {
          state?: () => Promise<string>
          redirectToAuthorization?: (url: URL) => Promise<void>
          saveCodeVerifier?: (v: string) => Promise<void>
          tokens?: () => Promise<{ access_token: string } | undefined>
          clientInformation?: () => Promise<{ client_id: string } | undefined>
          saveClientInformation?: (info: { client_id: string; client_secret?: string }) => Promise<void>
          saveTokens?: (tokens: { access_token: string; token_type: string }) => Promise<void>
        }
      | undefined
    constructor(url: URL, options?: { authProvider?: unknown }) {
      this.authProvider = options?.authProvider as typeof this.authProvider
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      if (connectSucceedsImmediately) return

      // Simulate what the real SDK transport does on 401:
      // It calls auth() which eventually calls provider.state(), then
      // provider.redirectToAuthorization(), then throws UnauthorizedError.
      if (simulateAuthFlow && this.authProvider) {
        if (await this.authProvider.tokens?.()) throw new MockUnauthorizedError()
        if (await this.authProvider.clientInformation?.()) throw new MockUnauthorizedError()
        // The SDK calls provider.state() to get the OAuth state parameter
        if (this.authProvider.state) {
          await this.authProvider.state()
        }
        // The SDK calls saveCodeVerifier before redirecting
        if (this.authProvider.saveCodeVerifier) {
          await this.authProvider.saveCodeVerifier("test-verifier")
        }
        // The SDK calls redirectToAuthorization to redirect the user
        if (this.authProvider.redirectToAuthorization) {
          await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?state=test"))
        }
        throw new MockUnauthorizedError()
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      if (finishAuthFails) throw new Error("Token exchange failed")
      if (finishAuthStoresCredentials) {
        await this.authProvider?.saveClientInformation?.({ client_id: "replacement-client" })
        await this.authProvider?.saveTokens?.({ access_token: "replacement-token", token_type: "Bearer" })
      }
    }
    async close() {}
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
  },
}))

// Mock the MCP SDK Client
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    setRequestHandler() {}

    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }

    setNotificationHandler() {}

    getServerCapabilities() {
      return serverCapabilities
    }

    getInstructions() {}

    async listTools() {
      listToolsCalls++
      return { tools: [{ name: "test_tool", inputSchema: { type: "object", properties: {} } }] }
    }

    async listResources() {
      return { resources: [{ name: "docs", uri: "docs://readme" }] }
    }

    async close() {}
  },
}))

// Mock UnauthorizedError in the auth module so instanceof checks work
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  transportCalls.length = 0
  simulateAuthFlow = true
  connectSucceedsImmediately = false
  serverCapabilities = { tools: {} }
  listToolsCalls = 0
  finishAuthFails = false
  finishAuthStoresCredentials = false
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { EventV2Bridge } = await import("../../src/event-v2-bridge")
const { Config } = await import("../../src/config/config")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { FSUtil } = await import("@opencode-ai/core/fs-util")
const { CrossSpawnSpawner } = await import("@opencode-ai/core/cross-spawn-spawner")

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

const config = (name: string) => ({
  mcp: {
    [name]: {
      type: "remote" as const,
      url: "https://example.com/mcp",
    },
  },
})

mcpTest.instance(
  "first connect to OAuth server shows needs_auth instead of failed",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const result = yield* mcp.add("test-oauth", {
          type: "remote",
          url: "https://example.com/mcp",
        })

        const serverStatus = result.status as Record<string, { status: string; error?: string }>

        // The server should be detected as needing auth, NOT as failed.
        // Before the fix, provider.state() would throw a plain Error
        // ("No OAuth state saved for MCP server: test-oauth") which was
        // not caught as UnauthorizedError, causing status to be "failed".
        expect(serverStatus["test-oauth"]).toBeDefined()
        expect(serverStatus["test-oauth"].status).toBe("needs_auth")
      }),
    ),
  { config: config("test-oauth") },
)

mcpTest.instance("state() generates a new state when none is saved", () =>
  Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const provider = new McpOAuthProvider(
      "test-state-gen",
      "https://example.com/mcp",
      {},
      { onRedirect: async () => {} },
      auth,
    )

    const entryBefore = yield* McpAuth.use.get("test-state-gen")
    expect(entryBefore?.oauthState).toBeUndefined()

    // state() should generate and return a new state, not throw
    const state = yield* Effect.promise(() => provider.state())
    expect(typeof state).toBe("string")
    expect(state.length).toBe(64) // 32 bytes as hex

    // The generated state should be persisted
    const entryAfter = yield* McpAuth.use.get("test-state-gen")
    expect(entryAfter?.oauthState).toBe(state)
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

    // Pre-save a state
    const existingState = "pre-saved-state-value"
    yield* McpAuth.use.updateOAuthState("test-state-existing", existingState)

    // state() should return the existing state
    const state = yield* Effect.promise(() => provider.state())
    expect(state).toBe(existingState)
  }),
)

mcpTest.instance(
  "failed reauthentication preserves existing credentials",
  () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      const name = "test-reauth-failure"
      const url = "https://example.com/mcp"
      const clientInfo = { clientId: "dynamic-client", clientSecret: "dynamic-secret" }

      yield* auth.updateClientInfo(name, clientInfo, url)
      yield* auth.updateTokens(name, { accessToken: "working-token" }, url)
      expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("https://auth.example.com/authorize")
      finishAuthFails = true

      expect(yield* mcp.finishAuth(name, "invalid-code")).toEqual({
        status: "failed",
        error: "OAuth completion failed: Token exchange failed",
      })
      const entry = yield* auth.get(name)
      expect(entry?.tokens?.accessToken).toBe("working-token")
      expect(entry?.clientInfo).toEqual(clientInfo)
    }),
  { config: config("test-reauth-failure") },
)

mcpTest.instance(
  "successful reauthentication commits replacement credentials",
  () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      const name = "test-reauth-success"
      const url = "https://example.com/mcp"

      yield* auth.updateClientInfo(name, { clientId: "old-client" }, url)
      yield* auth.updateTokens(name, { accessToken: "old-token" }, url)
      expect((yield* mcp.startAuth(name)).authorizationUrl).toContain("https://auth.example.com/authorize")
      expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")
      finishAuthStoresCredentials = true
      connectSucceedsImmediately = true

      expect((yield* mcp.finishAuth(name, "valid-code")).status).toBe("connected")
      const entry = yield* auth.get(name)
      expect(entry?.tokens?.accessToken).toBe("replacement-token")
      expect(entry?.clientInfo?.clientId).toBe("replacement-client")
      expect(entry?.serverUrl).toBe(url)
    }),
  { config: config("test-reauth-success") },
)

mcpTest.instance(
  "auth status only reports credentials stored for the configured server URL",
  () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      expect(transportCalls).toHaveLength(0)
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
      expect(transportCalls).toHaveLength(0)
    }),
  { config: config("test-status-url") },
)

mcpTest.instance(
  "authenticate() stores a connected client when auth completes without redirect",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const added = yield* mcp.add("test-oauth-connect", {
          type: "remote",
          url: "https://example.com/mcp",
        })
        const before = added.status as Record<string, { status: string; error?: string }>
        expect(before["test-oauth-connect"]?.status).toBe("needs_auth")

        simulateAuthFlow = false
        connectSucceedsImmediately = true

        const result = yield* mcp.authenticate("test-oauth-connect")
        expect(result.status).toBe("connected")

        const after = yield* mcp.status()
        expect(after["test-oauth-connect"]?.status).toBe("connected")
      }),
    ),
  { config: config("test-oauth-connect") },
)

mcpTest.instance(
  "authenticate() connects a resource-only server without listing tools",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        const added = yield* mcp.add("test-oauth-resources", {
          type: "remote",
          url: "https://example.com/mcp",
        })
        const before = added.status as Record<string, { status: string }>
        expect(before["test-oauth-resources"]?.status).toBe("needs_auth")

        simulateAuthFlow = false
        connectSucceedsImmediately = true
        serverCapabilities = { resources: {} }

        const result = yield* mcp.authenticate("test-oauth-resources")
        expect(result.status).toBe("connected")
        expect(listToolsCalls).toBe(0)
        expect(Object.keys(yield* mcp.resources())).toEqual(["test-oauth-resources:docs://readme"])
      }),
    ),
  { config: config("test-oauth-resources") },
)
