import { describe, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit }
}> = []

// Mock the transport constructors to capture their arguments
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit }) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

beforeEach(() => {
  transportCalls.length = 0
})

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const it = testEffect(MCP.defaultLayer)

describe("mcp.headers", () => {
  it.instance("headers are passed to transports when oauth is enabled (default)", () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      yield* mcp
        .add("test-server", {
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer test-token",
            "X-Custom-Header": "custom-value",
          },
        })
        .pipe(Effect.catch(() => Effect.void))

      // Both transports should have been created with headers
      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        })
        // OAuth should be enabled by default, so authProvider should exist
        expect(call.options.authProvider).toBeDefined()
      }
    }),
  )

  it.instance("headers are passed to transports when oauth is explicitly disabled", () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      yield* mcp
        .add("test-server-no-oauth", {
          type: "remote",
          url: "https://example.com/mcp",
          oauth: false,
          headers: {
            Authorization: "Bearer test-token",
          },
        })
        .pipe(Effect.catch(() => Effect.void))

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
        })
        // OAuth is disabled, so no authProvider
        expect(call.options.authProvider).toBeUndefined()
      }
    }),
  )

  it.instance("no requestInit when headers are not provided", () =>
    Effect.gen(function* () {
      const mcp = yield* MCP.Service
      yield* mcp
        .add("test-server-no-headers", {
          type: "remote",
          url: "https://example.com/mcp",
        })
        .pipe(Effect.catch(() => Effect.void))

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        // No headers means requestInit should be undefined
        expect(call.options.requestInit).toBeUndefined()
      }
    }),
  )
})
