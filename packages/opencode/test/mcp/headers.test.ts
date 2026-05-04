import { test, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit; fetch?: unknown }
}> = []

// Mock the transport constructors to capture their arguments
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit; fetch?: unknown }) {
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
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { Instance } = await import("../../src/project/instance")
const { WithInstance } = await import("../../src/project/with-instance")
const { tmpdir } = await import("../fixture/fixture")
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

test("headers are passed to transports when oauth is enabled (default)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          mcp: {
            "test-server": {
              type: "remote",
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer test-token",
                "X-Custom-Header": "custom-value",
              },
            },
          },
        }),
      )
    },
  })

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      // Trigger MCP initialization - it will fail to connect but we can check the transport options
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
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
        }),
      )

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
    },
  })
})

test("headers are passed to transports when oauth is explicitly disabled", async () => {
  await using tmp = await tmpdir()

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
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
        }),
      )

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
        })
        // OAuth is disabled, so no authProvider
        expect(call.options.authProvider).toBeUndefined()
      }
    },
  })
})

test("no requestInit when headers are not provided", async () => {
  await using tmp = await tmpdir()

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const mcp = yield* service
          yield* mcp
            .add("test-server-no-headers", {
              type: "remote",
              url: "https://example.com/mcp",
            })
            .pipe(Effect.catch(() => Effect.void))
        }),
      )

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        // No headers means requestInit should be undefined
        expect(call.options.requestInit).toBeUndefined()
      }
    },
  })
})

test("streamable http transport receives custom fetch that sets Accept header", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/opencode.json`,
        JSON.stringify({
          mcp: {
            test: {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
    run: async () => {
      const mcp = await Effect.runPromise(service)
      await Effect.runPromise(
        WithInstance.provide(
          mcp
            .connect({
              url: "https://example.com/mcp",
            })
            .pipe(Effect.catch(() => Effect.void)),
        ),
      )

      const streamableCall = transportCalls.find((c) => c.type === "streamable")
      expect(streamableCall).toBeDefined()
      expect(streamableCall!.options.fetch).toBeTypeOf("function")

      // Verify the custom fetch adds Accept header
      const customFetch = streamableCall!.options.fetch as typeof fetch
      const mockResponse = new Response("ok")
      const originalFetch = globalThis.fetch
      let capturedHeaders: Headers | undefined
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers)
        return Promise.resolve(mockResponse)
      }) as typeof fetch

      try {
        // Test with only text/event-stream (simulates SDK's GET request)
        await customFetch("https://example.com/mcp", {
          headers: { accept: "text/event-stream" },
        })
        expect(capturedHeaders!.get("accept")).toBe("application/json, text/event-stream")

        // Test with both already set (simulates SDK's POST request)
        await customFetch("https://example.com/mcp", {
          headers: { accept: "application/json, text/event-stream" },
        })
        expect(capturedHeaders!.get("accept")).toBe("application/json, text/event-stream")
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  })
})
