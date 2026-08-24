import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, mock, beforeEach, afterAll } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import * as RealMcpClient from "@modelcontextprotocol/client"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit }
}> = []

// fork(mcp-dual-era-client A3): v1 spread Client/transports across
// independently-mockable subpath modules; v2 consolidates almost everything
// into one @modelcontextprotocol/client package export. mock.module replaces
// a module's ENTIRE export set, so mocking only the two transport classes
// here would also blank out Client/UnauthorizedError that mcp/index.ts
// imports from the same specifier — spread the real module first, then
// override just the two constructors this file cares about.
await mock.module("@modelcontextprotocol/client", () => ({
  ...RealMcpClient,
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

// fork(mcp-dual-era-client D2): mock.module() mutates the module registry
// for the rest of the bun:test process, not just this file — without
// restoring it, any later-running file (alphabetically after this one) that
// needs the REAL @modelcontextprotocol/client silently gets this file's
// mock instead. Found via test/mcp/tool-profiles.test.ts failing only when
// run as part of the full suite, never in isolation.
afterAll(() => {
  mock.restore()
})

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const it = testEffect(AppNodeBuilder.build(MCP.node))

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
