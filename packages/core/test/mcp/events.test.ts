import { describe, expect, spyOn } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/client"
import { McpClient } from "@opencode/core/mcp/client"
import { Cause, Clock, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { hostEnvironmentLayer } from "../fixture/environment"
import { testEffect } from "../lib/effect"
import { serve } from "./fixture/http"
import { remote, until, world } from "./harness"

const it = testEffect(hostEnvironmentLayer)

/** A 2026-07-28 MCP server speaking raw JSON-RPC that offers two pages of event types and records the streams opened on it. */
const eventServer = Effect.fnUntraced(function* (
  input: { offers?: boolean; declares?: boolean; protocol?: "legacy" } = {},
) {
  const [client, server] = InMemoryTransport.createLinkedPair()
  const state = {
    capabilities: undefined as unknown,
    lists: [] as unknown[],
    streams: [] as Array<{ id: string | number; params: unknown }>,
    listens: [] as Array<{ id: string | number; params: unknown }>,
    cancelled: [] as unknown[],
  }
  const reply = (id: string | number, result: Record<string, unknown>) =>
    server.send({ jsonrpc: "2.0", id, result: { resultType: "complete", ...result } })
  const capabilities =
    input.offers === false ? {} : { extensions: { "io.modelcontextprotocol/events": { listChanged: true } } }
  server.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message)) return
    // Every 2026-07-28 request carries the protocol envelope in `_meta`; the tests check the rest.
    const { _meta: meta, ...params } = message.params ?? {}
    if (message.method === "notifications/cancelled") state.cancelled.push(params.requestId)
    if (!("id" in message)) return
    if (message.method === "server/discover") {
      state.capabilities = meta?.["io.modelcontextprotocol/clientCapabilities"]
      void reply(message.id, {
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "jobs", version: "1.0.0" } },
        supportedVersions: ["2026-07-28"],
        capabilities,
      })
    }
    if (message.method === "initialize") {
      state.capabilities = params.capabilities
      void reply(message.id, {
        protocolVersion: params.protocolVersion,
        capabilities,
        serverInfo: { name: "jobs", version: "1.0.0" },
      })
    }
    if (message.method === "events/list") {
      state.lists.push(params)
      void reply(
        message.id,
        params.cursor === "page-2"
          ? {
              events: [
                { name: "job.failed", delivery: ["push", "future"], inputSchema: {}, payloadSchema: {} },
                // Malformed: no payloadSchema. Skipped without hiding the others.
                { name: "job.broken", delivery: ["push"], inputSchema: {} },
              ],
            }
          : {
              events: [
                {
                  name: "job.finished",
                  description: "A job ended",
                  delivery: ["push", "poll"],
                  inputSchema: { type: "object" },
                  payloadSchema: { type: "object" },
                },
              ],
              nextCursor: "page-2",
            },
      )
    }
    if (message.method === "events/stream") state.streams.push({ id: message.id, params })
    if (message.method === "subscriptions/listen") {
      state.listens.push({ id: message.id, params })
      void server.send({
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: {
          notifications: params.notifications,
          _meta: { "io.modelcontextprotocol/subscriptionId": message.id },
        },
      })
    }
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
    target: { type: "attached", transport: client, protocol: input.protocol ?? "2026-07-28" },
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

const reached = (check: () => boolean) =>
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

describe("MCP events client", () => {
  it.effect("declares the extension and lists every page of event types", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      expect(server.state.capabilities).toMatchObject({ extensions: { "io.modelcontextprotocol/events": {} } })
      expect(yield* required(server.events).list()).toEqual([
        {
          name: "job.finished",
          description: "A job ended",
          delivery: ["push", "poll"],
          inputSchema: { type: "object" },
          payloadSchema: { type: "object" },
        },
        { name: "job.failed", delivery: ["push", "future"], inputSchema: {}, payloadSchema: {} },
      ])
      expect(server.state.lists.slice(0, 2)).toEqual([{}, { cursor: "page-2" }])
      // It listens for event list changes and relists once the listen opens, again on a change, and again after a
      // listen the server ended is reopened. Each relist reads both pages.
      yield* reached(() => server.state.listens.length === 1 && server.state.lists.length === 4)
      expect(server.state.listens[0].params).toEqual({ notifications: { eventsListChanged: true } })
      yield* server.notify("list_changed", server.state.listens[0].id)
      yield* reached(() => server.state.lists.length === 6)
      yield* server.close(server.state.listens[0].id)
      // The listen reopens after a backoff on the test clock. Nothing else waits on the in-memory server.
      while (!(server.state.listens.length === 2 && server.state.lists.length === 8)) {
        yield* Effect.promise(() => Bun.sleep(1))
        yield* TestClock.adjust("200 millis")
      }
    }),
  )

  it.live("delivers every message of a stream in order and ends when the server closes it", () =>
    Effect.gen(function* () {
      const server = yield* eventServer()
      const collected = yield* Stream.runCollect(
        required(server.events).stream({ name: "job.finished", arguments: { job: "j1" }, cursor: "c0" }),
      ).pipe(Effect.forkChild({ startImmediately: true }))
      yield* reached(() => server.state.streams.length === 1)
      const stream = server.state.streams[0]
      // Resuming from a cursor replays at most an hour.
      expect(stream.params).toEqual({
        name: "job.finished",
        arguments: { job: "j1" },
        cursor: "c0",
        maxAgeMs: 3_600_000,
      })
      yield* server.notify("active", stream.id, { cursor: "c0", truncated: true, heartbeatMs: 30_000 })
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
      yield* reached(() => server.state.streams.length === 1)
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
      yield* reached(() => server.state.cancelled.includes(id))
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
      yield* reached(() => server.state.streams.length === 2)
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
      yield* reached(() => server.state.streams.length === 1)
      const id = server.state.streams[0].id
      yield* server.notify("active", id, { cursor: null, truncated: false, heartbeatMs: 30_000 })
      expect(yield* Fiber.join(head)).toMatchObject({ value: { type: "active", cursor: null } })
      yield* reached(() => server.state.cancelled.includes(id))
    }),
  )

  it.effect("fails a stream that misses three granted heartbeats", () =>
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
      yield* reached(() => server.state.streams.length === 1)
      const id = server.state.streams[0].id
      // A 10 second grant allows 30 seconds of silence from the last message.
      yield* server.notify("active", id, { cursor: null, heartbeatMs: 10_000 })
      yield* reached(() => received.includes("active"))
      yield* TestClock.adjust("29 seconds")
      yield* Effect.yieldNow
      expect(collected.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("2 seconds")
      const exit = yield* Fiber.await(collected)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toEqual(
        new Error("MCP server jobs stopped sending event stream heartbeats"),
      )
      yield* reached(() => server.state.cancelled.includes(id))
    }),
  )

  it.live("offers no events when the server does not, on the legacy handshake, or when undeclared", () =>
    Effect.gen(function* () {
      expect((yield* eventServer({ offers: false })).events).toBeUndefined()
      expect((yield* eventServer({ protocol: "legacy" })).events).toBeUndefined()
      const undeclared = yield* eventServer({ declares: false })
      expect(undeclared.events).toBeUndefined()
      expect(undeclared.state.capabilities).not.toHaveProperty("extensions")
    }),
  )
})

describe("MCP event subscriptions", () => {
  testEffect(Layer.empty).effect(
    "back off failed opens, reset after a confirmed open, and mark a replay gap once",
    () =>
      Effect.gen(function* () {
        const server = yield* serve({ era: "modern", events: true })
        // The first two opens fail, each once the test releases it.
        const failures = yield* Queue.unbounded<void>()
        const failing = { left: 2 }
        server.intercept(async (_, body) => {
          if (body?.method !== "events/stream" || failing.left === 0) return undefined
          failing.left--
          await Effect.runPromise(Queue.take(failures))
          return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "Temporary failure" } })
        })
        const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
        yield* place.settled("fixture")
        const events = yield* place.mcp.events("fixture")
        if (!events) throw new Error("expected MCP events")
        const clock = yield* Clock.Clock
        const openedAt: number[] = []
        const failed = yield* Queue.unbounded<void>()
        const open = events.stream
        // A failed open stays pending. Wait for the client stream to fail, not just for the server to reply.
        using observer = spyOn(events, "stream")
        observer.mockImplementation((input) => {
          openedAt.push(clock.currentTimeMillisUnsafe())
          return open(input).pipe(Stream.onError(() => Queue.offer(failed, undefined)))
        })
        // Each reopen waits its delay after the stream ended, jittered to between 0.8 and 1.2 times it. The test clock
        // moves only when adjusted, so the time read once the end is seen is exact. A failed open is released only after
        // the adjust that started it returns, so its reply can't land mid-adjust.
        const waited = (delay: number, since: number) => {
          const gap = openedAt[openedAt.length - 1] - since
          expect(gap).toBeGreaterThanOrEqual(delay * 0.8)
          expect(gap).toBeLessThanOrEqual(delay * 1.2)
        }
        const status = () => place.mcp.subscriptions().pipe(Effect.map((all) => all[0]))
        const settled = <A>(effect: Effect.Effect<A>, ready: (value: A) => boolean) =>
          Effect.gen(function* () {
            while (true) {
              const value = yield* effect
              if (ready(value)) return value
              yield* Effect.promise(() => Bun.sleep(1))
            }
          })
        yield* place.mcp.subscribe("fixture", { name: "job.finished" })
        yield* Queue.offer(failures, undefined)
        yield* Queue.take(failed)
        const first = clock.currentTimeMillisUnsafe()
        yield* TestClock.adjust("1200 millis")
        expect(openedAt).toHaveLength(2)
        waited(1000, first)
        yield* Queue.offer(failures, undefined)
        yield* Queue.take(failed)
        const second = clock.currentTimeMillisUnsafe()
        yield* TestClock.adjust("2400 millis")
        expect(openedAt).toHaveLength(3)
        waited(2000, second)

        const stream = yield* server.opened
        yield* settled(status(), (sub) => sub?.status.status === "active")
        stream.send("notifications/events/heartbeat", { cursor: "c5" })
        const closed = clock.currentTimeMillisUnsafe()
        stream.close()
        expect(yield* settled(status(), (sub) => sub?.status.status === "pending")).toMatchObject({ cursor: "c5" })
        yield* TestClock.adjust("1200 millis")
        expect(openedAt).toHaveLength(4)
        waited(1000, closed)
        const reopened = yield* server.opened
        expect(reopened.params).toMatchObject({ cursor: "c5" })
        // The server says it skipped events it could not replay: only the next one delivered is marked.
        reopened.send("notifications/events/active", { cursor: "c8", truncated: true, heartbeatMs: 30_000 })
        const [gap, next] = [server.emit(), server.emit()]
        const delivered = yield* settled(
          Effect.sync(() => place.events.filter((event) => event.type === "experimental.mcp.event")),
          (list) => list.length === 2,
        )
        expect(delivered.map((event) => event.data)).toMatchObject([
          { eventId: gap, truncated: true },
          { eventId: next },
        ])
        expect(delivered[1]?.data).not.toHaveProperty("truncated")
      }),
  )

  testEffect(Layer.empty).live("end when the server terminates or rejects them, or offers no events", () =>
    Effect.gen(function* () {
      const server = yield* serve({ era: "modern", events: true })
      const plain = yield* serve({ era: "modern" })
      const place = yield* (yield* world).open({ servers: { fixture: remote(server.url), plain: remote(plain.url) } })
      yield* place.settled("fixture")
      yield* place.settled("plain")
      const status = (id: string) =>
        place.mcp.subscriptions().pipe(Effect.map((all) => all.find((sub) => sub.id === id)?.status))
      const ended = (id: string) => until(`${id} to end`, status(id), (value) => value?.status === "ended")

      const finished = yield* place.mcp.subscribe("fixture", { name: "job.finished" })
      const stream = yield* server.opened
      stream.send("notifications/events/terminated", { error: { code: -32024, message: "Revoked" } })
      expect(yield* ended(finished.id)).toEqual({
        status: "ended",
        reason: "terminated",
        error: { code: -32024, message: "Revoked" },
      })
      // An unlisted type is refused without asking the server.
      const missing = yield* place.mcp.subscribe("fixture", { name: "missing" })
      expect(yield* ended(missing.id)).toMatchObject({ status: "ended", reason: "rejected", error: { code: -32023 } })
      expect(server.seen.methods.filter((method) => method === "events/stream")).toHaveLength(1)

      expect(yield* place.mcp.events("plain")).toBeUndefined()
      const none = yield* place.mcp.subscribe("plain", { name: "job.finished" })
      expect(yield* ended(none.id)).toEqual({ status: "ended", reason: "unavailable" })
    }),
  )

  testEffect(Layer.empty).live(
    "send an event type's arguments as headers, relisting once when the server says they are stale",
    () =>
      Effect.gen(function* () {
        const server = yield* serve({ era: "modern", events: true })
        const streams: Array<string | null> = []
        // From the second listing on, `job` is mirrored into a header, which the server requires.
        server.intercept((request, body) => {
          if (body?.method === "events/list")
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                resultType: "complete",
                events: [
                  {
                    name: "job.finished",
                    delivery: ["push"],
                    inputSchema: {
                      type: "object",
                      properties: {
                        job: {
                          type: "string",
                          ...(server.seen.methods.filter((method) => method === "events/list").length > 1
                            ? { "x-mcp-header": "Job" }
                            : {}),
                        },
                      },
                    },
                    payloadSchema: { type: "object" },
                  },
                ],
              },
            })
          if (body?.method !== "events/stream") return undefined
          streams.push(request.headers.get("mcp-param-job"))
          if (request.headers.get("mcp-name") !== "job.finished") return new Response(null, { status: 400 })
          if (request.headers.get("mcp-param-job") === null)
            return Response.json(
              { jsonrpc: "2.0", id: body.id, error: { code: -32020, message: "Header mismatch" } },
              { status: 400 },
            )
        })
        const place = yield* (yield* world).open({ servers: { fixture: remote(server.url) } })
        yield* place.settled("fixture")
        yield* place.mcp.subscribe("fixture", { name: "job.finished", arguments: { job: "j1" } })
        yield* server.opened
        expect(streams).toEqual([null, "j1"])
      }),
  )
})
