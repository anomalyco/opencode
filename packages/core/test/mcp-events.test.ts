import { describe, expect } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/client"
import { McpClient } from "@opencode/core/mcp/client"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { TestClock } from "effect/testing"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(hostEnvironmentLayer)

/** An MCP server speaking raw JSON-RPC that offers two pages of event types and records the streams opened on it. */
const eventServer = Effect.fnUntraced(function* (input: { offers?: boolean; declares?: boolean } = {}) {
  const [client, server] = InMemoryTransport.createLinkedPair()
  const state = {
    capabilities: undefined as unknown,
    lists: [] as unknown[],
    streams: [] as Array<{ id: string | number; params: unknown }>,
    cancelled: [] as unknown[],
  }
  const reply = (id: string | number, result: Record<string, unknown>) => server.send({ jsonrpc: "2.0", id, result })
  server.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message)) return
    const params = message.params ?? {}
    if (message.method === "notifications/cancelled") state.cancelled.push(params.requestId)
    if (!("id" in message)) return
    if (message.method === "initialize") {
      state.capabilities = params.capabilities
      void reply(message.id, {
        protocolVersion: params.protocolVersion,
        capabilities: input.offers === false ? {} : { extensions: { "io.modelcontextprotocol/events": {} } },
        serverInfo: { name: "jobs", version: "1.0.0" },
      })
    }
    if (message.method === "events/list") {
      state.lists.push(params)
      void reply(
        message.id,
        params.cursor === "page-2"
          ? { events: [{ name: "job.failed", delivery: ["push"] }] }
          : { events: [{ name: "job.finished", description: "A job ended", inputSchema: {} }], nextCursor: "page-2" },
      )
    }
    if (message.method === "events/stream") state.streams.push({ id: message.id, params })
  }
  yield* Effect.promise(() => server.start())
  const notify = (type: string, id: string | number, params: Record<string, unknown> = {}) =>
    Effect.promise(() =>
      server.send({
        jsonrpc: "2.0",
        method: `notifications/events/${type}`,
        params: { ...params, _meta: { "io.modelcontextprotocol/subscriptionId": id } },
      }),
    )
  const connection = yield* McpClient.connect({
    server: "jobs",
    config: { type: "attached", transport: client },
    directory: import.meta.dir,
    events: input.declares ?? true,
  })
  return {
    state,
    events: connection.events,
    notify,
    event: (id: string | number, eventId: string, cursor?: string) =>
      notify("event", id, {
        eventId,
        name: "job.finished",
        timestamp: "2026-11-10T00:00:00Z",
        data: { eventId },
        cursor,
      }),
    close: (id: string | number) => Effect.promise(() => reply(id, {})),
  }
})

const until = (check: () => boolean) =>
  Effect.promise(async () => {
    const deadline = Date.now() + 5_000
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out")
      await Bun.sleep(1)
    }
  })

const required = <A>(value: A | undefined) => {
  if (value === undefined) throw new Error("expected a value")
  return value
}

describe("MCP events", () => {
  it.live("declares the extension and lists every page of event types", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      expect(server.state.capabilities).toMatchObject({ extensions: { "io.modelcontextprotocol/events": {} } })
      expect(yield* required(server.events).list()).toEqual([
        { name: "job.finished", description: "A job ended", inputSchema: {} },
        { name: "job.failed", delivery: ["push"] },
      ])
      expect(server.state.lists).toEqual([{}, { cursor: "page-2" }])
    }),
  )

  it.live("delivers every message of a stream in order and ends when the server closes it", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const collected = yield* Stream.runCollect(
        required(server.events).stream({ name: "job.finished", arguments: { job: "j1" }, cursor: "c0" }),
      ).pipe(Effect.forkChild({ startImmediately: true }))
      yield* until(() => server.state.streams.length === 1)
      const stream = server.state.streams[0]
      expect(stream.params).toEqual({ name: "job.finished", arguments: { job: "j1" }, cursor: "c0" })
      yield* server.notify("active", stream.id, { cursor: "c0", truncated: true })
      yield* server.event(stream.id, "e1", "c1")
      yield* server.notify("heartbeat", stream.id, { cursor: "c2" })
      yield* server.notify("error", stream.id, { error: { code: -32603, message: "UpstreamError" } })
      yield* server.event(stream.id, "e2")
      yield* server.close(stream.id)
      expect(yield* Fiber.join(collected)).toEqual([
        { type: "active", cursor: "c0", truncated: true },
        {
          type: "event",
          eventId: "e1",
          name: "job.finished",
          timestamp: "2026-11-10T00:00:00Z",
          data: { eventId: "e1" },
          cursor: "c1",
        },
        { type: "heartbeat", cursor: "c2" },
        { type: "error", error: { code: -32603, message: "UpstreamError" } },
        {
          type: "event",
          eventId: "e2",
          name: "job.finished",
          timestamp: "2026-11-10T00:00:00Z",
          data: { eventId: "e2" },
          cursor: null,
        },
      ])
    }),
  )

  it.live("fails a stream the server terminates, and cancels its request", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const collected = yield* Stream.runCollect(required(server.events).stream({ name: "job.finished" })).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* until(() => server.state.streams.length === 1)
      const id = server.state.streams[0].id
      yield* server.notify("terminated", id, {
        error: { code: -32024, message: "Forbidden", data: { reason: "revoked" } },
      })
      const exit = yield* Fiber.await(collected)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toEqual(
        new McpClient.EventStreamTerminatedError({
          server: "jobs",
          code: -32024,
          message: "Forbidden",
          data: { reason: "revoked" },
        }),
      )
      yield* until(() => server.state.cancelled.includes(id))
    }),
  )

  it.live("routes concurrent streams by subscription id", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const events = required(server.events)
      const first = (job: string) =>
        Stream.runHead(events.stream({ name: "job.finished", arguments: { job } })).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
      const a = yield* first("a")
      const b = yield* first("b")
      yield* until(() => server.state.streams.length === 2)
      const [streamA, streamB] = server.state.streams
      yield* server.event(streamB.id, "for-b")
      yield* server.event(streamA.id, "for-a")
      expect(yield* Fiber.join(a)).toMatchObject({ value: { eventId: "for-a" } })
      expect(yield* Fiber.join(b)).toMatchObject({ value: { eventId: "for-b" } })
    }),
  )

  it.live("cancels the request when the consumer stops reading", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const head = yield* Stream.runHead(required(server.events).stream({ name: "job.finished" })).pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* until(() => server.state.streams.length === 1)
      const id = server.state.streams[0].id
      yield* server.notify("active", id, { cursor: null, truncated: false })
      expect(yield* Fiber.join(head)).toMatchObject({ value: { type: "active", cursor: null } })
      yield* until(() => server.state.cancelled.includes(id))
    }),
  )

  it.effect("fails a stream that sends nothing for a minute", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const received: string[] = []
      const collected = yield* required(server.events)
        .stream({ name: "job.finished" })
        .pipe(
          Stream.tap((message) => Effect.sync(() => received.push(message.type))),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        )
      yield* until(() => server.state.streams.length === 1)
      const id = server.state.streams[0].id
      yield* TestClock.adjust("59 seconds")
      yield* server.notify("heartbeat", id, { cursor: "c1" })
      // The heartbeat restarts the idle timer only once the stream has taken it.
      yield* until(() => received.includes("heartbeat"))
      yield* TestClock.adjust("59 seconds")
      yield* Effect.yieldNow
      expect(collected.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("2 seconds")
      const exit = yield* Fiber.await(collected)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toEqual(
        new Error("MCP server jobs sent nothing on the event stream for 60 seconds"),
      )
      yield* until(() => server.state.cancelled.includes(id))
    }),
  )

  it.live("offers no events when the server does not, or when the connection does not declare them", () =>
    Effect.gen(function* () {
      expect((yield* eventServer({ offers: false })).events).toBeUndefined()
      const undeclared = yield* eventServer({ declares: false })
      expect(undeclared.events).toBeUndefined()
      expect(undeclared.state.capabilities).not.toHaveProperty("extensions")
    }),
  )
})
