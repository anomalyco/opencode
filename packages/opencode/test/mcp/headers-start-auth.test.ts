import { test, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// Mock UnauthorizedError so instanceof checks in startAuth work
class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track constructor arguments for all StreamableHTTPClientTransport instances
const transportCalls: Array<{
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit }
}> = []

// The mock transport simulates a 401 that captures the auth URL via
// authProvider.redirectToAuthorization(), then throws UnauthorizedError —
// exactly what the real SDK transport does on a 401 response.
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      this.authProvider = options?.authProvider as typeof this.authProvider
      transportCalls.push({ url: url.toString(), options: options ?? {} })
    }
    async start() {
      if (this.authProvider?.redirectToAuthorization) {
        await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=test"))
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({ url: url.toString(), options: options ?? {} })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
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

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

test("startAuth passes headers to StreamableHTTPClientTransport", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          mcp: {
            "test-server": {
              type: "remote",
              url: "https://example.com/mcp",
              headers: { "X-Custom-Header": "realm-value" },
              oauth: {},
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // startAuth throws (no real callback server) but we only care that the
      // transport was constructed with the correct requestInit before that.
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          yield* mcp.startAuth("test-server").pipe(Effect.ignore)
        }),
      )

      const startAuthCall = transportCalls.find((c) => c.url === "https://example.com/mcp")
      expect(startAuthCall).toBeDefined()
      expect(startAuthCall!.options.requestInit).toBeDefined()
      expect(startAuthCall!.options.requestInit?.headers).toEqual({
        "X-Custom-Header": "realm-value",
      })
    },
  })
})

test("startAuth does not set requestInit when no headers are configured", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          mcp: {
            "test-server-no-headers": {
              type: "remote",
              url: "https://example.com/mcp",
              oauth: {},
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          yield* mcp.startAuth("test-server-no-headers").pipe(Effect.ignore)
        }),
      )

      const startAuthCall = transportCalls.find((c) => c.url === "https://example.com/mcp")
      expect(startAuthCall).toBeDefined()
      expect(startAuthCall!.options.requestInit).toBeUndefined()
    },
  })
})
