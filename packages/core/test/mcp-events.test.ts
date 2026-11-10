import { describe, expect } from "bun:test"
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Mcp } from "@opencode/core/mcp/index"
import { McpClient } from "@opencode/core/mcp/client"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpEventTools } from "@opencode/core/tool/plugin/mcp-events"
import { Effect, Fiber, Layer, Option, PubSub, Stream } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { advance } from "./lib/clock"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const it = testEffect(AppNodeBuilder.build(Tool.node, toolNodeReplacements()))
const sessionID = Session.ID.make("ses_mcp_events")

/** An MCP server speaking raw JSON-RPC that offers one event type and records the streams opened on it. */
const eventServer = Effect.fnUntraced(function* () {
  const [client, server] = InMemoryTransport.createLinkedPair()
  const state = {
    capabilities: undefined as unknown,
    streams: [] as Array<{ id: string | number; params: unknown }>,
    cancelled: [] as unknown[],
  }
  const reply = (id: string | number, result: Record<string, unknown>) => server.send({ jsonrpc: "2.0", id, result })
  server.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message)) return
    const params = (message.params ?? {}) as Record<string, unknown>
    if (message.method === "notifications/cancelled") state.cancelled.push(params.requestId)
    if (!("id" in message)) return
    if (message.method === "initialize") {
      state.capabilities = params.capabilities
      void reply(message.id, {
        protocolVersion: params.protocolVersion,
        capabilities: { extensions: { "io.modelcontextprotocol/events": {} } },
        serverInfo: { name: "jobs", version: "1.0.0" },
      })
    }
    if (message.method === "events/list")
      void reply(message.id, { events: [{ name: "job.finished", description: "A job ended", inputSchema: {} }] })
    if (message.method === "events/stream") state.streams.push({ id: message.id, params })
  }
  yield* Effect.promise(() => server.start())
  const notify = (method: string, id: string | number, params: Record<string, unknown>) =>
    Effect.promise(() =>
      server.send({
        jsonrpc: "2.0",
        method,
        params: { ...params, _meta: { "io.modelcontextprotocol/subscriptionId": id } },
      }),
    )
  return {
    state,
    connection: yield* McpClient.connect({
      server: "jobs",
      config: { type: "attached", transport: client },
      directory: import.meta.dir,
    }).pipe(Effect.provide(hostEnvironmentLayer)),
    event: (id: string | number, eventId: string, cursor?: string) =>
      notify("notifications/events/event", id, {
        eventId,
        name: "job.finished",
        timestamp: "2026-11-10T00:00:00Z",
        data: { job: eventId },
        cursor,
      }),
    terminate: (id: string | number) =>
      notify("notifications/events/terminated", id, { error: { code: -32024, message: "Forbidden" } }),
    close: (id: string | number) => Effect.promise(() => reply(id, {})),
  }
})

const stopped = (reason: string) => ({
  sessionID,
  description: "jobs job.finished watch stopped",
  text: `Watching jobs job.finished stopped: ${reason}`,
  metadata: { source: "mcp.event", server: "jobs", event: "job.finished" },
})

const until = (check: () => boolean) =>
  Effect.promise(async () => {
    const deadline = Date.now() + 5_000
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out")
      await Bun.sleep(1)
    }
  })

const setup = Effect.fnUntraced(function* () {
  const server = yield* eventServer()
  const wakes: Array<{
    sessionID: string
    id?: string
    description?: string
    text: string
    metadata?: Record<string, unknown>
  }> = []
  const deleted = yield* PubSub.unbounded<{ type: "session.deleted"; data: { sessionID: string } }>()
  yield* registerToolPlugin(McpEventTools.Plugin, {
    event: { subscribe: () => Stream.fromPubSub(deleted) as never },
    session: { synthetic: (input) => Effect.sync(() => void wakes.push(input)) as never },
  }).pipe(
    Effect.provide(permissionLayer({ assert: () => Effect.void })),
    Effect.provide(Flag.testLayer([], { overrides: "mcp_events" })),
    Effect.provide(
      Layer.mock(Mcp.Service, {
        servers: () => Effect.succeed([{ name: "jobs", status: { status: "connected" } }]),
        events: () => Effect.succeed(server.connection.events),
      }),
    ),
  )
  const registry = yield* Tool.Service
  const watch = (input: Record<string, unknown>, session = sessionID) =>
    registry.snapshot([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
      Effect.flatMap((tools) =>
        tools.execute({
          sessionID: session,
          ...toolIdentity,
          call: { type: "tool-call", id: "call_watch", name: "opencode_watch_mcp_event", input },
        }),
      ),
      Effect.orDie,
    )
  return { ...server, wakes, watch, deleted }
})

describe("watch_mcp_event", () => {
  it.live("lists event types, then wakes the session once per event and ends a once watch", () =>
    Effect.gen(function* () {
      const { state, wakes, watch, event } = yield* setup()
      expect(state.capabilities).toMatchObject({ extensions: { "io.modelcontextprotocol/events": {} } })
      expect((yield* watch({})).output).toEqual({
        events: [{ server: "jobs", name: "job.finished", description: "A job ended", inputSchema: {} }],
      })

      yield* watch({ server: "jobs", event: "job.finished", arguments: { job_id: "j1" }, cursor: "c0" })
      yield* until(() => state.streams.length === 1)
      expect(state.streams[0].params).toEqual({
        name: "job.finished",
        arguments: { job_id: "j1" },
        cursor: "c0",
        _meta: { "ai.opencode/stream": expect.any(String) },
      })
      const id = state.streams[0].id
      yield* event(id, "e1", "c1")
      yield* until(() => state.cancelled.includes(id))
      expect(wakes).toEqual([
        {
          sessionID,
          id: expect.stringMatching(/^msg_mcp_/),
          description: "jobs job.finished",
          text: '<mcp_event server="jobs" event="job.finished" id="e1" timestamp="2026-11-10T00:00:00Z">\n{"job":"e1"}\n</mcp_event>',
          metadata: { source: "mcp.event", server: "jobs", event: "job.finished", eventID: "e1" },
        },
      ])
      // The stream is gone, so a late event wakes nothing.
      yield* event(id, "e2", "c2")
      yield* Effect.sleep("20 millis")
      expect(wakes).toHaveLength(1)
    }),
  )

  it.live(
    "gives a replayed event the same message, and stops when the session is deleted or the stream terminated",
    () =>
      Effect.gen(function* () {
        const { state, wakes, watch, event, terminate, deleted } = yield* setup()
        yield* watch({ server: "jobs", event: "job.finished", once: false })
        yield* until(() => state.streams.length === 1)
        const first = state.streams[0].id
        yield* event(first, "e1", "c1")
        yield* event(first, "e1", "c1")
        yield* event(first, "e2", "c2")
        yield* until(() => wakes.length === 3)
        expect(wakes[1].id).toBe(wakes[0].id)
        expect(wakes[2].id).not.toBe(wakes[0].id)

        // Deleting the session cancels its stream.
        yield* PubSub.publish(deleted, { type: "session.deleted", data: { sessionID } })
        yield* until(() => state.cancelled.includes(first))

        // A terminated stream ends the watch and wakes the session to say so, once.
        yield* watch({ server: "jobs", event: "job.finished", once: false })
        yield* until(() => state.streams.length === 2)
        const second = state.streams[1].id
        yield* terminate(second)
        yield* event(second, "e3", "c3")
        yield* until(() => wakes.length === 4)
        yield* Effect.sleep("20 millis")
        expect(wakes.slice(3)).toEqual([stopped("Forbidden")])
        expect(state.streams).toHaveLength(2)
      }),
  )

  it.effect("reopens a stream the server closes from the last cursor, until it closes it three times in a row", () =>
    Effect.gen(function* () {
      const { state, wakes, watch, event, close } = yield* setup()
      const reopened = (count: number) => advance(() => state.streams.length === count)
      yield* watch({ server: "jobs", event: "job.finished", once: false })
      yield* reopened(1)
      yield* event(state.streams[0].id, "e1", "c1")
      // An event without a cursor keeps the last one.
      yield* event(state.streams[0].id, "e2")
      yield* advance(() => wakes.length === 2)
      yield* close(state.streams[0].id)
      yield* reopened(2)
      expect(state.streams[1].params).toMatchObject({ cursor: "c1" })

      // An event starts the count again: two more closes reopen, and the third in a row stops the watch.
      yield* event(state.streams[1].id, "e3", "c3")
      yield* advance(() => wakes.length === 3)
      yield* close(state.streams[1].id)
      yield* reopened(3)
      yield* close(state.streams[2].id)
      yield* reopened(4)
      expect(state.streams[3].params).toMatchObject({ cursor: "c3" })
      yield* close(state.streams[3].id)
      yield* advance(() => wakes.length === 4)
      expect(wakes[3]).toEqual(stopped("the server kept closing the stream"))
      expect(state.streams).toHaveLength(4)
    }),
  )

  it.live("keeps a stream open past the server's execution timeout", () =>
    Effect.gen(function* () {
      // A Streamable HTTP server that holds `events/stream` open as SSE and sends one event when told to.
      const opened: Array<(event: Record<string, unknown>) => void> = []
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          if (request.method !== "POST") return new Response(null, { status: 405 })
          const message = (await request.json()) as {
            id?: string | number
            method: string
            params: { protocolVersion?: string }
          }
          if (message.id === undefined) return new Response(null, { status: 202 })
          if (message.method === "initialize")
            return Response.json({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: message.params.protocolVersion,
                capabilities: { extensions: { "io.modelcontextprotocol/events": {} } },
                serverInfo: { name: "jobs", version: "1.0.0" },
              },
            })
          const body = new ReadableStream({
            start: (controller) =>
              void opened.push((params) =>
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/events/event", params: { ...params, _meta: { "io.modelcontextprotocol/subscriptionId": message.id } } })}\n\n`,
                  ),
                ),
              ),
          })
          return new Response(body, { headers: { "content-type": "text/event-stream" } })
        },
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => http.stop(true)))
      const connection = yield* McpClient.connect({
        server: "jobs",
        config: new ConfigMCP.Remote({
          type: "remote",
          url: http.url.href,
          oauth: false,
          timeout: new ConfigMCP.Timeout({ execution: 50 }),
        }),
        directory: import.meta.dir,
      }).pipe(Effect.provide(hostEnvironmentLayer))
      const next = yield* Effect.forkChild(Stream.runHead(connection.events!.stream({ name: "job.finished" })), {
        startImmediately: true,
      })
      yield* until(() => opened.length === 1)
      yield* Effect.sleep("150 millis")
      opened[0]({ eventId: "e1", name: "job.finished", timestamp: "2026-11-10T00:00:00Z", data: {}, cursor: "c1" })
      expect(Option.getOrThrow(yield* Fiber.join(next))).toMatchObject({ eventId: "e1", cursor: "c1" })
    }),
  )

  it.live("routes each event to its own stream while other requests go out alongside", () =>
    Effect.gen(function* () {
      const { state, wakes, watch, event } = yield* setup()
      const sessions = { a: Session.ID.make("ses_mcp_events_a"), b: Session.ID.make("ses_mcp_events_b") }
      yield* Effect.all(
        [
          watch({ server: "jobs", event: "job.finished", arguments: { job_id: "a" } }, sessions.a),
          watch({}),
          watch({ server: "jobs", event: "job.finished", arguments: { job_id: "b" } }, sessions.b),
          watch({}),
        ],
        { concurrency: "unbounded" },
      )
      yield* until(() => state.streams.length === 2)
      for (const stream of state.streams) {
        const job = (stream.params as { arguments: { job_id: string } }).arguments.job_id
        yield* event(stream.id, job, job)
      }
      yield* until(() => wakes.length === 2)
      expect(Object.fromEntries(wakes.map((wake) => [wake.sessionID, wake.metadata?.eventID]))).toEqual({
        [sessions.a]: "a",
        [sessions.b]: "b",
      })
    }),
  )
})
