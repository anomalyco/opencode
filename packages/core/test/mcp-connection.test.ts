import { expect } from "bun:test"
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { Mcp } from "@opencode/schema/mcp"
import { Environment } from "@opencode/core/environment/index"
import { McpConnection } from "@opencode/core/mcp/connection"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Effect, FiberSet, Schema, Semaphore } from "effect"
import { TestClock } from "effect/testing"
import { advance, drain } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"

const connection = (failure: "network" | number | Error = 503) =>
  Effect.gen(function* () {
    const state: {
      failure: typeof failure | undefined
      status: Mcp.Status
      attempts: number
      failures: number
      calls: number
      catalogFailure: number | undefined
    } = {
      failure,
      status: { status: "pending" },
      attempts: 0,
      failures: 0,
      calls: 0,
      catalogFailure: undefined,
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
          if (state.failure === "network") throw Object.assign(new Error("VPN unavailable"), { code: "ENOTFOUND" })
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
    const fork = yield* FiberSet.makeRuntime<never, void, never>()
    const lock = Semaphore.makeUnsafe(1)
    const current: McpConnection.Connection = McpConnection.make({
      name: "test",
      config: new ConfigMCP.Remote({ type: "remote", url: "https://mcp.example.test/mcp", oauth: false }),
      directory: import.meta.dir,
      authProvider: Effect.succeed(undefined),
      environment: yield* Environment.Service,
      fetch,
      scope: yield* Effect.scope,
      lock: lock.withPermit,
      handshake: (effect) => effect,
      callbacks: fork,
      fork,
      elicitation: { create: () => Effect.succeed({ action: "cancel" }), complete: () => Effect.void },
      events: {
        connecting: Effect.sync(() => {
          state.status = { status: "pending" }
        }),
        connected: Effect.sync(() => {
          state.status = { status: "connected" }
        }),
        failed: (failure) =>
          Effect.sync(() => {
            state.status = failure
            state.failures++
          }),
        settled: Effect.void,
        closed: () => current.stop,
        changed: () => Effect.void,
      },
    })
    return { state, current, start: lock.withPermit(current.start), stop: lock.withPermit(current.stop) }
  })

const it = testEffect(hostEnvironmentLayer)

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
      target.state.failure = undefined
      yield* advance(() => target.state.status.status === "connected")
      expect(target.current.tools?.map((tool) => tool.name)).toEqual(["write"])
    }),
  )
}

it.effect("stops scheduled reconnection when explicitly disconnected", () =>
  Effect.gen(function* () {
    const target = yield* connection()
    yield* Effect.forkChild(target.start, { startImmediately: true })
    yield* advance(() => target.state.failures > 0)
    yield* target.stop
    const attempts = target.state.attempts
    target.state.failure = undefined
    yield* TestClock.adjust("10 minutes")
    yield* drain
    expect(target.state.attempts).toBe(attempts)
    expect(target.current.client).toBeUndefined()
  }),
)

it.effect("backs off persistent outages instead of continuously reconnecting", () =>
  Effect.gen(function* () {
    const target = yield* connection()
    yield* Effect.forkChild(target.start, { startImmediately: true })
    yield* advance(() => target.state.failures === 4)
    const attempts = target.state.attempts
    yield* TestClock.adjust("1 second")
    yield* drain
    expect(target.state.attempts).toBe(attempts)
  }),
)

for (const failure of [401, 403, 404, 501]) {
  it.effect(`does not schedule reconnection for permanent HTTP ${failure}`, () =>
    Effect.gen(function* () {
      const target = yield* connection(failure)
      yield* target.start
      const attempts = target.state.attempts
      yield* TestClock.adjust("10 minutes")
      yield* drain
      expect(target.state.attempts).toBe(attempts)
      expect(target.current.client).toBeUndefined()
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
