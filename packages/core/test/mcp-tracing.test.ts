import { expect } from "bun:test"
import { isJSONRPCRequest } from "@modelcontextprotocol/client"
import { createMcpHandler, Server } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Session } from "@opencode/schema/session"
import { McpClient } from "@opencode/core/mcp/client"
import { Effect, Fiber, References, Tracer } from "effect"
import { FetchHttpClient } from "effect/http"
import { isRecord } from "@opencode/util/record"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(hostEnvironmentLayer)
const parent = Tracer.externalSpan({ traceId: "1".repeat(32), spanId: "2".repeat(16), sampled: true })
const traceparent = `00-${parent.traceId}-${parent.spanId}-01`
const sessionID = Session.ID.make("ses_mcp_trace")

// One child covers actual stdio serialization; HTTP owns reuse, concurrency and retry below.
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
    const call = connection.callTool({ name: "echo", sessionID })
    for (const sampled of [false, true, undefined]) {
      const result = yield* (sampled === undefined
        ? call
        : call.pipe(Effect.withParentSpan(Tracer.externalSpan({ ...parent, sampled }))))
      const content = result.content[0]
      if (content?.type !== "text") throw new Error("Expected metadata echo")
      const meta = JSON.parse(content.text)
      expect(meta["ai.opencode/sessionID"]).toBe(sessionID)
      expect(meta.progressToken).toBeDefined()
      expect(meta.traceparent).toBe(
        sampled === undefined ? undefined : `00-${parent.traceId}-${parent.spanId}-0${Number(sampled)}`,
      )
    }
  }),
)

const gateway = (
  input: {
    readonly call?: (args: Record<string, unknown> | undefined) => Promise<void>
    readonly respond?: (request: Request) => Promise<Response | undefined>
  } = {},
) =>
  Effect.gen(function* () {
    const signals: AbortSignal[] = []
    const metadata: Array<{ method: string; meta: unknown; args?: Record<string, unknown> }> = []
    const wire: Array<{ method: string; headers: Headers; args?: Record<string, unknown> }> = []
    const handler = createMcpHandler(() => {
      const server = new Server(
        { name: "trace-fixture", version: "1.0.0" },
        { capabilities: { tools: {}, prompts: {}, resources: {} } },
      )
      server.setRequestHandler("tools/list", (request) => {
        metadata.push({ method: request.method, meta: request.params?._meta })
        return Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" } }] })
      })
      server.setRequestHandler("prompts/list", () => Promise.resolve({ prompts: [] }))
      server.setRequestHandler("resources/list", () => Promise.resolve({ resources: [] }))
      server.setRequestHandler("resources/templates/list", () => Promise.resolve({ resourceTemplates: [] }))
      server.setRequestHandler("prompts/get", () => Promise.resolve({ messages: [] }))
      server.setRequestHandler("resources/read", (request) =>
        Promise.resolve({ contents: [{ uri: request.params.uri, text: "ok" }] }),
      )
      server.setRequestHandler("tools/call", async (request) => {
        metadata.push({ method: request.method, meta: request.params._meta, args: request.params.arguments })
        await input.call?.(request.params.arguments)
        return { content: [{ type: "text", text: "ok" }] }
      })
      return server
    }, { legacy: "reject" })
    yield* Effect.addFinalizer(() => Effect.promise(() => handler.close()))
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
            return (await input.respond?.(request)) ?? handler.fetch(request)
          },
        }),
      ),
      (http) => Effect.promise(() => http.stop(true)),
    )
    const connection = yield* McpClient.connect({
      server: "tracing",
      directory: import.meta.dir,
      config: new ConfigMCP.Remote({
        type: "remote",
        url: http.url.href,
        protocol: "2026-07-28",
        oauth: false,
        headers: { "x-configured": "preserved", Authorization: "Bearer configured" },
      }),
    }).pipe(
      Effect.withParentSpan(parent),
      Effect.provideService(
        FetchHttpClient.Fetch,
        Object.assign(
          (input: string | URL | Request, init?: RequestInit) => {
            if (init?.signal && typeof init.body === "string" && JSON.parse(init.body).method === "tools/call")
              signals.push(init.signal)
            return fetch(input, init)
          },
          { preconnect: fetch.preconnect },
        ),
      ),
    )
    return { connection, metadata, wire, signals }
  })

it.live("reads context at each execution without retaining connection or prior-call context", () =>
  Effect.gen(function* () {
    const fixture = yield* gateway()
    const call = fixture.connection.callTool({ name: "echo", sessionID })
    yield* call.pipe(Effect.withParentSpan(parent))
    yield* call
    yield* call.pipe(Effect.withSpan("MCP.callTool"))
    yield* call.pipe(Effect.withTracerEnabled(false), Effect.withParentSpan(parent))
    yield* call.pipe(Effect.provideService(References.DisablePropagation, true), Effect.withParentSpan(parent))
    expect(fixture.metadata).toHaveLength(5)
    expect(fixture.metadata[0]?.meta).toMatchObject({ traceparent })
    const calls = fixture.wire.filter((request) => request.method === "tools/call")
    expect(calls).toHaveLength(5)
    expect(calls[0]?.headers.get("traceparent")).toBe(traceparent)
    for (const request of fixture.metadata)
      expect(request.meta).toMatchObject({ "ai.opencode/sessionID": sessionID, progressToken: expect.anything() })
    for (const request of fixture.metadata.slice(1))
      for (const key of ["traceparent", "tracestate"]) expect(request.meta).not.toHaveProperty(key)
    for (const request of calls) {
      expect(request.headers.get("x-configured")).toBe("preserved")
      expect(request.headers.get("authorization")).toBe("Bearer configured")
    }
    for (const request of calls.slice(1))
      for (const key of ["traceparent", "tracestate"]) expect(request.headers.has(key)).toBe(false)
  }),
)

it.live("isolates overlapping callers on one HTTP connection", () =>
  Effect.gen(function* () {
    const both = Promise.withResolvers<void>()
    const a = Promise.withResolvers<void>()
    const b = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() => Effect.sync(() => { a.resolve(); b.resolve() }))
    const state = { arrivals: 0 }
    const fixture = yield* gateway({
      call: (args) => {
        if (++state.arrivals === 2) both.resolve()
        return args?.label === "a" ? a.promise : b.promise
      },
    })
    const first = yield* fixture.connection
      .callTool({ name: "echo", args: { label: "a" } })
      .pipe(Effect.withParentSpan(parent), Effect.forkChild({ startImmediately: true }))
    const second = yield* fixture.connection
      .callTool({ name: "echo", args: { label: "b" } })
      .pipe(
        Effect.withParentSpan(Tracer.externalSpan({ traceId: "3".repeat(32), spanId: "4".repeat(16), sampled: false })),
        Effect.forkChild({ startImmediately: true }),
      )
    yield* Effect.promise(() => both.promise)
    b.resolve()
    yield* Fiber.join(second)
    a.resolve()
    yield* Fiber.join(first)
    for (const [label, expected] of [["a", traceparent], ["b", `00-${"3".repeat(32)}-${"4".repeat(16)}-00`]]) {
      expect(fixture.metadata.find((request) => request.args?.label === label)?.meta).toMatchObject({
        traceparent: expected,
      })
      expect(fixture.wire.find((request) => request.args?.label === label)?.headers.get("traceparent")).toBe(expected)
    }
  }),
)

it.live("retries stale tool definitions with caller context, without tracing other operations", () =>
  Effect.gen(function* () {
    const rejected: string[] = []
    const fixture = yield* gateway({
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
    yield* Effect.gen(function* () {
      yield* fixture.connection.tools()
      yield* fixture.connection.prompts()
      yield* fixture.connection.resources()
      yield* fixture.connection.resourceTemplates()
      yield* fixture.connection.prompt({ name: "echo" })
      yield* fixture.connection.readResource({ uri: "test://trace" })
      expect(yield* fixture.connection.callTool({ name: "echo", sessionID })).toMatchObject({ isError: false })
    }).pipe(Effect.withParentSpan(parent))
    expect(rejected).toHaveLength(1)
    expect(fixture.metadata.filter((request) => request.method === "tools/list")).toHaveLength(2)
    const calls = fixture.wire.filter((request) => request.method === "tools/call")
    expect(calls).toHaveLength(2)
    for (const request of calls) expect(request.headers.get("traceparent")).toBe(traceparent)
    expect(fixture.metadata.find((request) => request.method === "tools/call")?.meta).toMatchObject({ traceparent })
    for (const request of fixture.wire.filter((request) => request.method !== "tools/call"))
      expect(request.headers.has("traceparent")).toBe(false)
    for (const request of fixture.metadata.filter((request) => request.method !== "tools/call"))
      expect(request.meta).toBeUndefined()
  }),
)

it.live("cancels only the traced request and reuses the connection without context", () =>
  Effect.gen(function* () {
    const arrived = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const fixture = yield* gateway({
      call: (args) => {
        if (args?.label !== "cancel") return Promise.resolve()
        arrived.resolve()
        return release.promise
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
    const call = yield* fixture.connection
      .callTool({ name: "echo", args: { label: "cancel" } })
      .pipe(Effect.withParentSpan(parent), Effect.forkChild({ startImmediately: true }))
    yield* Effect.promise(() => arrived.promise)
    yield* Fiber.interrupt(call)
    release.resolve()
    expect(yield* fixture.connection.callTool({ name: "echo" })).toMatchObject({ isError: false })
    const calls = fixture.wire.filter((request) => request.method === "tools/call")
    expect(calls[0]?.headers.get("traceparent")).toBe(traceparent)
    expect(calls[1]?.headers.has("traceparent")).toBe(false)
    expect(fixture.signals).toHaveLength(2)
    expect(fixture.signals[0]?.aborted).toBe(true)
    expect(fixture.signals[1]?.aborted).toBe(false)
  }),
)
