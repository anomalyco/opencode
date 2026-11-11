import { expect } from "bun:test"
import { InMemoryTransport, isJSONRPCRequest } from "@modelcontextprotocol/client"
import { createMcpHandler, Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Session } from "@opencode/schema/session"
import { McpClient } from "@opencode/core/mcp/client"
import { Effect, Fiber, References, Tracer } from "effect"
import { isRecord } from "@opencode/util/record"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(hostEnvironmentLayer)

const parent = Tracer.externalSpan({
  traceId: "11111111111111111111111111111111",
  spanId: "2222222222222222",
  sampled: true,
})
const traceparent = "00-11111111111111111111111111111111-2222222222222222-01"
const sessionID = Session.ID.make("ses_mcp_trace")

// One real child covers the stdio serialization boundary; concurrency and retry ownership live below.
it.live("serializes caller context through the production stdio transport", () =>
  Effect.gen(function* () {
    const connection = yield* McpClient.connect({
      server: "trace-echo",
      directory: import.meta.dir,
      config: new ConfigMCP.Local({
        type: "local",
        command: [process.execPath, `${import.meta.dir}/fixture/mcp-tracing.ts`],
      }),
    }).pipe(Effect.withParentSpan(parent))
    for (const sampled of [false, true, undefined]) {
      const operation = Effect.gen(function* () {
        const tool = yield* connection.callTool({ name: "echo", sessionID })
        const prompt = yield* connection.prompt({ name: "echo" })
        const resource = yield* connection.readResource({ uri: "test://trace" })
        expect(tool.content[0]?.type).toBe("text")
        for (const result of [tool.content[0], prompt.messages[0]?.content, resource?.contents[0]]) {
          if (!result || !("text" in result)) throw new Error("Expected trace echo text")
          const meta = JSON.parse(result.text)
          if (result === tool.content[0]) expect(meta).toMatchObject({ "ai.opencode/sessionID": sessionID })
          if (sampled === undefined) {
            for (const key of ["traceparent", "tracestate", "baggage"]) expect(meta).not.toHaveProperty(key)
            continue
          }
          expect(meta).toMatchObject({
            traceparent: `00-11111111111111111111111111111111-2222222222222222-0${Number(sampled)}`,
          })
        }
      })
      yield* (sampled === undefined
        ? operation
        : operation.pipe(
            Effect.withParentSpan(Tracer.externalSpan({
              traceId: parent.traceId,
              spanId: parent.spanId,
              sampled,
            })),
          ))
    }
  }),
)

const gateway = (
  kind: "attached" | "legacy" | "modern",
  input: {
    readonly call?: (args: Record<string, unknown> | undefined) => Promise<void>
    readonly respond?: (request: Request) => Promise<Response | undefined>
  } = {},
) =>
  Effect.gen(function* () {
    const metadata: Array<{ method: string; meta: unknown; args?: Record<string, unknown> }> = []
    const wire: Array<{ method: string; headers: Headers; args?: Record<string, unknown> }> = []
    const make = () => {
      const server = new Server(
        { name: "trace-fixture", version: "1.0.0" },
        { capabilities: { tools: {}, prompts: {}, resources: {} } },
      )
      server.setRequestHandler("tools/list", (request) => {
        metadata.push({ method: request.method, meta: request.params?._meta })
        return Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" } }] })
      })
      server.setRequestHandler("prompts/list", (request) => {
        metadata.push({ method: request.method, meta: request.params?._meta })
        return Promise.resolve({ prompts: [] })
      })
      server.setRequestHandler("resources/list", (request) => {
        metadata.push({ method: request.method, meta: request.params?._meta })
        return Promise.resolve({ resources: [] })
      })
      server.setRequestHandler("resources/templates/list", (request) => {
        metadata.push({ method: request.method, meta: request.params?._meta })
        return Promise.resolve({ resourceTemplates: [] })
      })
      server.setRequestHandler("tools/call", async (request) => {
        metadata.push({ method: request.method, meta: request.params._meta, args: request.params.arguments })
        await input.call?.(request.params.arguments)
        return { content: [{ type: "text", text: "ok" }] }
      })
      server.setRequestHandler("prompts/get", (request) => {
        metadata.push({ method: request.method, meta: request.params._meta })
        return Promise.resolve({ messages: [{ role: "user", content: { type: "text", text: "ok" } }] })
      })
      server.setRequestHandler("resources/read", (request) => {
        metadata.push({ method: request.method, meta: request.params._meta })
        return Promise.resolve({ contents: [{ uri: request.params.uri, text: "ok" }] })
      })
      return server
    }
    if (kind === "attached") {
      const [client, transport] = InMemoryTransport.createLinkedPair()
      const server = make()
      yield* Effect.acquireRelease(
        Effect.promise(() => server.connect(transport)),
        () => Effect.promise(() => server.close()),
      )
      return { config: { type: "attached" as const, transport: client }, metadata, wire }
    }
    const server = make()
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(transport)),
      () => Effect.promise(() => server.close()),
    )
    const modern = kind === "modern" ? createMcpHandler(make, { legacy: "reject" }) : undefined
    if (modern) yield* Effect.addFinalizer(() => Effect.promise(() => modern.close()))
    const http = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            if (request.method === "POST") {
              const body = await request.clone().json()
              if (isJSONRPCRequest(body))
                wire.push({
                  method: body.method,
                  headers: request.headers,
                  args: isRecord(body.params?.arguments) ? body.params.arguments : undefined,
                })
            }
            return (await input.respond?.(request)) ?? modern?.fetch(request) ?? transport.handleRequest(request)
          },
        }),
      ),
      (http) => Effect.promise(() => http.stop(true)),
    )
    return {
      config: new ConfigMCP.Remote({
        type: "remote",
        url: http.url.href,
        protocol: kind === "modern" ? "2026-07-28" : "legacy",
        oauth: false,
        headers: { "x-configured": "preserved", Authorization: "Bearer configured" },
      }),
      metadata,
      wire,
    }
  })

for (const kind of ["attached", "legacy", "modern"] as const)
  it.live(`propagates the current caller's trace through ${kind} MCP requests`, () =>
    Effect.gen(function* () {
      const fixture = yield* gateway(kind)
      const connection = yield* McpClient.connect({
        server: "tracing",
        config: fixture.config,
        directory: import.meta.dir,
      })
      yield* Effect.gen(function* () {
        yield* connection.callTool({ name: "echo", sessionID })
        yield* connection.prompt({ name: "example" })
        yield* connection.readResource({ uri: "test://resource" })
      }).pipe(Effect.withParentSpan(parent))

      expect(fixture.metadata).toHaveLength(3)
      for (const request of fixture.metadata) expect(request.meta).toMatchObject({ traceparent })
      expect(fixture.metadata[0]?.meta).toMatchObject({ "ai.opencode/sessionID": sessionID })
      for (const request of fixture.wire.filter((request) =>
        ["tools/call", "prompts/get", "resources/read"].includes(request.method),
      )) {
        expect(request.headers.get("traceparent")).toBe(traceparent)
        expect(request.headers.get("x-configured")).toBe("preserved")
        expect(request.headers.get("authorization")).toBe("Bearer configured")
      }
    }),
  )

for (const kind of ["attached", "legacy", "modern"] as const) {
  it.live(`does not retain connection or previous-call context in ${kind} MCP requests`, () =>
    Effect.gen(function* () {
      const fixture = yield* gateway(kind)
      const connection = yield* McpClient.connect({
        server: "tracing",
        config: fixture.config,
        directory: import.meta.dir,
      }).pipe(Effect.withParentSpan(parent))
      const call = connection.callTool({ name: "echo", sessionID })
      yield* call.pipe(Effect.withParentSpan(parent))
      yield* call
      yield* call.pipe(Effect.withTracerEnabled(false), Effect.withParentSpan(parent))
      yield* call.pipe(Effect.provideService(References.DisablePropagation, true), Effect.withParentSpan(parent))
      expect(fixture.metadata[0]?.meta).toMatchObject({ traceparent })
      for (const request of fixture.metadata.slice(1)) {
        expect(request.meta).toMatchObject({ "ai.opencode/sessionID": sessionID })
        for (const key of ["traceparent", "tracestate", "baggage"]) expect(request.meta).not.toHaveProperty(key)
      }
      const calls = fixture.wire.filter((request) => request.method === "tools/call")
      for (const request of calls.slice(1))
        for (const key of ["traceparent", "tracestate", "baggage"]) expect(request.headers.has(key)).toBe(false)
    }),
  )

  it.live(`isolates concurrent callers on one ${kind} MCP connection`, () =>
    Effect.gen(function* () {
      const both = Promise.withResolvers<void>()
      const a = Promise.withResolvers<void>()
      const b = Promise.withResolvers<void>()
      const state = { arrivals: 0 }
      const fixture = yield* gateway(kind, {
        call: (args) => {
          state.arrivals += 1
          if (state.arrivals === 2) both.resolve()
          return args?.label === "a" ? a.promise : b.promise
        },
      })
      const connection = yield* McpClient.connect({
        server: "tracing",
        config: fixture.config,
        directory: import.meta.dir,
      })
      const other = Tracer.externalSpan({
        traceId: "33333333333333333333333333333333",
        spanId: "4444444444444444",
        sampled: false,
      })
      const first = yield* connection
        .callTool({ name: "echo", args: { label: "a" } })
        .pipe(Effect.withParentSpan(parent), Effect.forkChild({ startImmediately: true }))
      const second = yield* connection
        .callTool({ name: "echo", args: { label: "b" } })
        .pipe(Effect.withParentSpan(other), Effect.forkChild({ startImmediately: true }))
      yield* Effect.promise(() => both.promise)
      b.resolve()
      yield* Fiber.join(second)
      a.resolve()
      yield* Fiber.join(first)

      for (const [label, expected] of [
        ["a", traceparent],
        ["b", "00-33333333333333333333333333333333-4444444444444444-00"],
      ]) {
        expect(fixture.metadata.find((request) => request.args?.label === label)?.meta).toMatchObject({
          traceparent: expected,
        })
        if (kind !== "attached")
          expect(fixture.wire.find((request) => request.args?.label === label)?.headers.get("traceparent")).toBe(
            expected,
          )
      }
    }),
  )

  it.live(`propagates context to ${kind} MCP catalog requests`, () =>
    Effect.gen(function* () {
      const fixture = yield* gateway(kind)
      const connection = yield* McpClient.connect({
        server: "tracing",
        config: fixture.config,
        directory: import.meta.dir,
      })
      yield* Effect.all([
        connection.tools(),
        connection.prompts(),
        connection.resources(),
        connection.resourceTemplates(),
      ]).pipe(Effect.withParentSpan(parent))
      expect(fixture.metadata).toHaveLength(4)
      for (const request of fixture.metadata) expect(request.meta).toMatchObject({ traceparent })
      for (const request of fixture.wire.filter((request) => request.method.endsWith("/list")))
        expect(request.headers.get("traceparent")).toBe(traceparent)
    }),
  )
}

it.live("preserves caller context when a modern MCP tool call is relisted and retried", () =>
  Effect.gen(function* () {
    const rejected: string[] = []
    const fixture = yield* gateway("modern", {
      respond: async (request) => {
        if (request.method !== "POST") return undefined
        const body = await request.clone().json()
        if (!isJSONRPCRequest(body) || body.method !== "tools/call" || rejected.length) return undefined
        rejected.push(body.method)
        return Response.json(
          { jsonrpc: "2.0", id: body.id, error: { code: -32020, message: "Header mismatch" } },
          { status: 400 },
        )
      },
    })
    const connection = yield* McpClient.connect({
      server: "tracing",
      config: fixture.config,
      directory: import.meta.dir,
    })
    yield* Effect.gen(function* () {
      yield* connection.tools()
      expect(yield* connection.callTool({ name: "echo", sessionID })).toMatchObject({ isError: false })
    }).pipe(Effect.withParentSpan(parent))
    expect(rejected).toHaveLength(1)
    expect(fixture.wire.filter((request) => request.method === "tools/call")).toHaveLength(2)
    expect(fixture.metadata.filter((request) => request.method === "tools/list")).toHaveLength(2)
    for (const request of fixture.metadata) expect(request.meta).toMatchObject({ traceparent })
    for (const request of fixture.wire.filter((request) => ["tools/list", "tools/call"].includes(request.method))) {
      expect(request.headers.get("traceparent")).toBe(traceparent)
      expect(request.headers.get("authorization")).toBe("Bearer configured")
    }
  }),
)

for (const kind of ["legacy", "modern"] as const)
  it.live(`keeps cancellation scoped to the traced ${kind} HTTP request`, () =>
    Effect.gen(function* () {
      const arrived = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const fixture = yield* gateway(kind, {
        call: (args) => {
          if (args?.label !== "cancel") return Promise.resolve()
          arrived.resolve()
          return release.promise
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      const connection = yield* McpClient.connect({
        server: "tracing",
        config: fixture.config,
        directory: import.meta.dir,
      })
      const call = yield* connection
        .callTool({ name: "echo", args: { label: "cancel" } })
        .pipe(Effect.withParentSpan(parent), Effect.forkChild({ startImmediately: true }))
      yield* Effect.promise(() => arrived.promise)
      yield* Fiber.interrupt(call)
      release.resolve()
      expect(yield* connection.callTool({ name: "echo" })).toMatchObject({ isError: false })
      const calls = fixture.wire.filter((request) => request.method === "tools/call")
      expect(calls[0]?.headers.get("traceparent")).toBe(traceparent)
      expect(calls[1]?.headers.has("traceparent")).toBe(false)
    }),
  )
