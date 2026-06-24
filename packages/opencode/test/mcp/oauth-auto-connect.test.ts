import { expect, mock, beforeEach } from "bun:test"
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
let saveTokensOnConnect = false
let serverCapabilities: { tools?: object; resources?: object } = { tools: {} }
let listToolsCalls = 0

// Mock the transport constructors to simulate OAuth auto-auth on 401
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    authProvider:
      | {
          state?: () => Promise<string>
          redirectToAuthorization?: (url: URL) => Promise<void>
          saveCodeVerifier?: (v: string) => Promise<void>
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
      if (connectSucceedsImmediately) {
        if (saveTokensOnConnect)
          await this.authProvider?.saveTokens?.({ access_token: "new-token", token_type: "bearer" })
        return
      }

      // Simulate what the real SDK transport does on 401:
      // It calls auth() which eventually calls provider.state(), then
      // provider.redirectToAuthorization(), then throws UnauthorizedError.
      if (simulateAuthFlow && this.authProvider) {
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
    async finishAuth(_code: string) {}
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
  saveTokensOnConnect = false
  serverCapabilities = { tools: {} }
  listToolsCalls = 0
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { EventV2Bridge } = await import("../../src/event-v2-bridge")
const { Config } = await import("../../src/config/config")
const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
const { FSUtil } = await import("@opencode-ai/core/fs-util")
const { CrossSpawnSpawner } = await import("@opencode-ai/core/cross-spawn-spawner")

const mcpTest = testEffect(
  Layer.mergeAll(
    MCP.layer.pipe(
      Layer.provide(McpAuth.defaultLayer),
      Layer.provideMerge(EventV2Bridge.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
    ),
    McpAuth.defaultLayer,
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
  "authenticate() stores a connected client when stored credentials connect without redirect",
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
        saveTokensOnConnect = true

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
        saveTokensOnConnect = true
        serverCapabilities = { resources: {} }

        const result = yield* mcp.authenticate("test-oauth-resources")
        expect(result.status).toBe("connected")
        expect(listToolsCalls).toBe(0)
        expect(Object.keys(yield* mcp.resources())).toEqual(["test-oauth-resources:docs://readme"])
      }),
    ),
  { config: config("test-oauth-resources") },
)
