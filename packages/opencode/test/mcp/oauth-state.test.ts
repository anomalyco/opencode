import { test, expect, mock, beforeEach } from "bun:test"

// Mock UnauthorizedError
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

// Mock the transport constructors - simulate a server that returns 401
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown }) {
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new MockUnauthorizedError()
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new MockUnauthorizedError()
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  transportCalls.length = 0
})

// Import after mocking
const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
const { McpAuth } = await import("../../src/mcp/auth")
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("state() generates and persists a new state when none exists", async () => {
  const provider = new McpOAuthProvider(
    "test-state-gen",
    "https://example.com/mcp",
    {},
    { onRedirect: async () => {} },
  )

  // Should NOT throw — should generate a new state
  const state = await provider.state()

  // Should be a 64-char hex string (32 bytes)
  expect(state).toMatch(/^[0-9a-f]{64}$/)

  // Calling again should return the same persisted value
  const state2 = await provider.state()
  expect(state2).toBe(state)

  // Verify it's actually persisted in McpAuth
  const entry = await McpAuth.get("test-state-gen")
  expect(entry?.oauthState).toBe(state)

  // Clean up
  await McpAuth.remove("test-state-gen")
})

test("state() returns existing state when one is saved", async () => {
  const savedState = "abc123def456"
  await McpAuth.updateOAuthState("test-state-existing", savedState)

  const provider = new McpOAuthProvider(
    "test-state-existing",
    "https://example.com/mcp",
    {},
    { onRedirect: async () => {} },
  )

  const state = await provider.state()
  expect(state).toBe(savedState)

  // Clean up
  await McpAuth.remove("test-state-existing")
})

test("first unauthenticated connect results in needs_auth, not failed", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-needs-auth": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await MCP.add("test-needs-auth", {
        type: "remote",
        url: "https://example.com/mcp",
      })

      // The critical assertion: status should be "needs_auth" not "failed"
      // Before the fix, state() would throw a generic Error which bypassed
      // the UnauthorizedError check and fell through to "failed"
      const status = result.status
      if (typeof status === "object" && "status" in status && typeof status.status === "string") {
        expect(status.status).toBe("needs_auth")
      } else {
        // status is a record of statuses keyed by name
        const serverStatus = (status as Record<string, { status: string }>)["test-needs-auth"]
        expect(serverStatus?.status).toBe("needs_auth")
      }
    },
  })
})
