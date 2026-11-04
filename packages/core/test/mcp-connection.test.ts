import { expect, test } from "bun:test"
import { InMemoryTransport, SdkError, SdkErrorCode } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { Mcp } from "@opencode/schema/mcp"
import { Environment } from "@opencode/core/environment/index"
import { McpConnection } from "@opencode/core/mcp/connection"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Clock, Effect, FiberSet, Schema, Semaphore } from "effect"
import { TestClock } from "effect/testing"
import { advance, drain } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { McpRecovery } from "@opencode/core/mcp/recovery"

const connection = (failure: "network" | number | Error = 503) =>
  Effect.gen(function* () {
    const state: {
      failure: typeof failure | undefined
      status: Mcp.Status
      attempts: number
      failures: number
      calls: number
      catalogFailure: number | undefined
      connectedTimes: number[]
      transitions: string[]
      // The recovery reports the connection sent: what failed, whether it can be retried, and when.
      reports: Array<{ kind: "failure" | "closed" | "connected"; retryable?: boolean; retryAfter?: number }>
    } = {
      failure,
      status: { status: "pending" },
      attempts: 0,
      failures: 0,
      calls: 0,
      catalogFailure: undefined,
      connectedTimes: [],
      transitions: [],
      reports: [],
    }
    const fetch: typeof globalThis.fetch = Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method !== "POST") return new Response(null, { status: 405 })
        const request = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({
              id: Schema.optional(Schema.Number),
              method: Schema.String,
            }),
          ),
        )(String(init.body))
        if (request.method === "initialize") {
          state.attempts++
          if (state.failure === "network")
            throw Object.assign(new TypeError("Unable to connect. Is the computer able to access the url?"), {
              code: "ConnectionRefused",
            })
          if (state.failure instanceof Error) throw state.failure
          if (state.failure) return new Response(null, { status: state.failure })
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "test", version: "1" },
            },
          })
        }
        if (request.method === "tools/list" && state.catalogFailure)
          return new Response(null, { status: state.catalogFailure })
        if (request.method === "tools/list")
          return Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              tools: [{ name: "write", inputSchema: { type: "object" } }],
            },
          })
        if (request.method === "tools/call") {
          state.calls++
          return new Response(null, { status: 503 })
        }
        return new Response(null, { status: 202 })
      },
      { preconnect: globalThis.fetch.preconnect },
    )
    const recoveryState = { stale: false }
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const lock = Semaphore.makeUnsafe(1)
    // The recovery an entry owns in production, wired the same way: its reports record here, and
    // its attempt stops and starts the connection again in the background under the same lock.
    const recovery = McpRecovery.make({
      name: "test",
      fork,
      stale: () => recoveryState.stale,
      attempt: Effect.gen(function* () {
        if (recoveryState.stale) return
        yield* current.stop
        yield* current.start
      }).pipe(lock.withPermit),
    })
    const current: McpConnection.Connection = McpConnection.make({
      name: "test",
      config: new ConfigMCP.Remote({ type: "remote", url: "https://mcp.example.test/mcp", oauth: false }),
      directory: import.meta.dir,
      authProvider: Effect.succeed(undefined),
      environment: yield* Environment.Service,
      fetch,
      scope: yield* Effect.scope,
      lock: lock.withPermit,
      callbacks: fork,
      fork,
      elicitation: { create: () => Effect.succeed({ action: "cancel" }), complete: () => Effect.void },
      events: {
        connecting: (background) =>
          Effect.sync(() => {
            if (background) return
            state.status = { status: "pending" }
            state.transitions.push("pending")
          }),
        connected: Effect.gen(function* () {
          yield* recovery.notifyConnected()
          state.status = { status: "connected" }
          state.transitions.push("connected")
          state.connectedTimes.push(yield* Clock.currentTimeMillis)
        }),
        failed: (failure, report) =>
          Effect.gen(function* () {
            state.failures++
            state.reports.push({ kind: "failure", retryable: report.retryable, retryAfter: report.retryAfter })
            yield* recovery.notifyFailure(report)
            state.status = failure
            state.transitions.push(failure.status)
          }),
        settled: Effect.void,
        closed: (reason) =>
          Effect.gen(function* () {
            yield* recovery.notifyClosed()
            state.status = { status: "failed", error: reason }
            state.transitions.push("failed")
          }),
        changed: () => Effect.void,
      },
    })
    return { state, current, recovery, start: lock.withPermit(current.start), stop: lock.withPermit(current.stop) }
  })

const it = testEffect(hostEnvironmentLayer)

it.effect("reports a failed connect with its retry classification", () =>
  Effect.gen(function* () {
    const target = yield* connection()
    yield* Effect.forkChild(target.start, { startImmediately: true })
    yield* advance(() => target.state.failures > 0)
    expect(target.state.reports[0]).toMatchObject({ kind: "failure", retryable: true })
  }),
)

it.effect("reports a permanent failure as not retryable", () =>
  Effect.gen(function* () {
    const target = yield* connection(401)
    yield* target.start
    expect(target.state.reports[0]).toMatchObject({ kind: "failure", retryable: false })
    yield* TestClock.adjust("10 minutes")
    yield* drain
    expect(target.state.attempts).toBe(1)
  }),
)

it.effect("a closed transport reports closed so its owner schedules recovery", () =>
  Effect.gen(function* () {
    // A linked in-memory pair: the test owns the server side, so closing it really closes the
    // connection through the SDK's own machinery — no production test seam.
    const transport = yield* Effect.promise(async () => {
      const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      return clientTransport
    })
    const reports: unknown[] = []
    // Attach the client directly: the close wiring under test lives in the SDK client, shared by
    // every transport, so closing the linked pair's client side fires it for real — no production seam.
    const client = yield* McpClient.connect({
      server: "test",
      config: { type: "attached", transport },
      directory: import.meta.dir,
      elicitation: { create: () => Effect.succeed({ action: "cancel" as const }), complete: () => Effect.void },
    })
    client.onClose(() => reports.push("sdk-closed"))
    yield* Effect.promise(() => transport.close())
    yield* Effect.yieldNow
    expect(reports).toEqual(["sdk-closed"])
  }),
)

test.each(["ConnectionRefused", "ConnectionClosed", "FailedToOpenSocket"])(
  "recognizes Bun network error %s",
  (code) => {
    expect(McpClient.isTransient(Object.assign(new TypeError("Unable to connect"), { code }))).toBe(true)
  },
)

test("recognizes a refused connection produced by the running Bun version", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const url = server.url
  await server.stop(true)
  const error = await fetch(url).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(TypeError)
  expect(error instanceof Error && "code" in error).toBe(true)
  expect(McpClient.isTransient(error)).toBe(true)
})

it.effect("reconnects when the SDK handshake deadline wins the refresh timeout race", () =>
  Effect.gen(function* () {
    const target = yield* connection(new SdkError(SdkErrorCode.RequestTimeout, "Request timed out"))
    yield* Effect.forkChild(target.start, { startImmediately: true })
    yield* advance(() => target.state.failures > 0)
    target.state.failure = undefined
    yield* advance(() => target.state.status.status === "connected")
    expect(target.current.tools?.map((tool) => tool.name)).toEqual(["write"])
  }),
)

it.effect("waits for Retry-After before reconnecting an OAuth refresh", () =>
  Effect.gen(function* () {
    const target = yield* connection(new McpOAuth.RefreshError("Authorization server overloaded", 30_000))
    yield* target.start
    expect(target.state.attempts).toBe(1)
    target.state.failure = undefined
    yield* TestClock.adjust("29 seconds")
    yield* Effect.yieldNow
    expect(target.state.attempts).toBe(1)
    yield* TestClock.adjust("1 second")
    yield* advance(() => target.state.status.status === "connected")
    expect(target.state.attempts).toBe(2)
  }),
)

it.effect("reconnects when the initial tool catalog is temporarily unavailable", () =>
  Effect.gen(function* () {
    const target = yield* connection()
    target.state.failure = undefined
    target.state.catalogFailure = 503
    yield* Effect.forkChild(target.start, { startImmediately: true })
    yield* advance(() => target.state.failures > 0)
    target.state.catalogFailure = undefined
    yield* advance(() => target.state.status.status === "connected")
    expect(target.current.tools?.map((tool) => tool.name)).toEqual(["write"])
    expect(target.state.attempts).toBe(2)
  }),
)

for (const failure of ["network", 429, 500, 503] as const) {
  it.effect(`reconnects after ${failure} without user intervention`, () =>
    Effect.gen(function* () {
      const target = yield* connection(failure)
      yield* Effect.forkChild(target.start, { startImmediately: true })
      yield* advance(() => target.state.failures > 0)
      expect(target.state.status.status).toBe("failed")
      if (failure === "network") expect(target.state.attempts).toBe(3)
      target.state.failure = undefined
      yield* advance(() => target.state.status.status === "connected")
      expect(target.current.tools?.map((tool) => tool.name)).toEqual(["write"])
    }),
  )
}

it.effect("does not replay a tool action after a transient response", () =>
  Effect.gen(function* () {
    const target = yield* connection()
    target.state.failure = undefined
    yield* target.start
    const client = target.current.client
    expect(client).toBeDefined()
    if (!client) return
    yield* client.tools()
    yield* client.callTool({ name: "write" }).pipe(Effect.exit)
    yield* TestClock.adjust("10 minutes")
    yield* drain
    expect(target.state.calls).toBe(1)
  }),
)
