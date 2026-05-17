import { describe, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import { context as OtelContext, trace, TraceFlags } from "@opentelemetry/api"
import { testEffect } from "../lib/effect"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown; requestInit?: RequestInit; fetch?: typeof fetch }
}> = []

// Mock the transport constructors to capture their arguments
void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit; fetch?: typeof fetch }) {
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
    constructor(url: URL, options?: { authProvider?: unknown; requestInit?: RequestInit; fetch?: typeof fetch }) {
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

// The OTEL endpoint env must remain set for the lifetime of this test file
// because Observability.enabled (the tracing fetch gate) reads it at access
// time. Restore on exit so concurrent test files aren't affected.
const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
process.on("exit", () => {
  if (otelEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = otelEndpoint
})

// Import MCP after mocking + env is set.
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

describe("mcp.tracing", () => {
  it.instance(
    "tracing fetch is attached when openTelemetry is enabled",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp
          .add("test-server", {
            type: "remote",
            url: "https://example.com/mcp",
          })
          .pipe(Effect.catch(() => Effect.void))

        expect(transportCalls.length).toBeGreaterThanOrEqual(1)
        for (const call of transportCalls) {
          expect(call.options.fetch).toBeDefined()
        }
      }),
    { config: { experimental: { openTelemetry: true } } },
  )

  it.instance(
    "tracing fetch is not attached when openTelemetry is disabled",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp
          .add("test-server", {
            type: "remote",
            url: "https://example.com/mcp",
          })
          .pipe(Effect.catch(() => Effect.void))

        expect(transportCalls.length).toBeGreaterThanOrEqual(1)
        for (const call of transportCalls) {
          expect(call.options.fetch).toBeUndefined()
        }
      }),
    { config: { experimental: { openTelemetry: false } } },
  )

  it.instance(
    "tracing fetch injects trace headers and preserves existing headers",
    () =>
      Effect.gen(function* () {
        const mcp = yield* MCP.Service
        yield* mcp
          .add("test-server", {
            type: "remote",
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer test-token",
            },
          })
          .pipe(Effect.catch(() => Effect.void))

        const call = transportCalls.find((item) => item.type === "streamable")
        expect(call).toBeDefined()
        expect(call?.options.fetch).toBeDefined()

        const originalFetch = globalThis.fetch
        const seenHeaders: Record<string, string> = {}
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const outgoing = input instanceof Request ? new Headers(input.headers) : new Headers(init?.headers)
          outgoing.forEach((value, key) => {
            seenHeaders[key] = value
          })
          return new Response("ok", { status: 200 })
        }) as typeof fetch

        try {
          const spanContext = trace.wrapSpanContext({
            traceId: "11111111111111111111111111111111",
            spanId: "2222222222222222",
            traceFlags: TraceFlags.SAMPLED,
          })

          yield* Effect.promise(() =>
            OtelContext.with(trace.setSpan(OtelContext.active(), spanContext), async () => {
              await call?.options.fetch?.(
                new Request("https://example.com/mcp", {
                  method: "POST",
                  headers: {
                    "x-from-request": "request-value",
                    authorization: "Bearer test-token",
                  },
                }),
                {
                  headers: {
                    "x-from-init": "init-value",
                  },
                },
              )
            }),
          )

          expect(seenHeaders.authorization).toBe("Bearer test-token")
          expect(seenHeaders["x-from-request"]).toBe("request-value")
          expect(seenHeaders["x-from-init"]).toBe("init-value")
          expect(seenHeaders.traceparent).toBe("00-11111111111111111111111111111111-2222222222222222-01")
        } finally {
          globalThis.fetch = originalFetch
        }
      }),
    { config: { experimental: { openTelemetry: true } } },
  )
})
