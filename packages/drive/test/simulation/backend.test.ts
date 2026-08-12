import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Option, Stream } from "effect"
import { Backend } from "../../src/client/index.js"
import * as SimulationConnector from "../../src/simulation/connector.js"
import { sendResult, startTransportPeer } from "./transport-peer.js"

const exchanges = {
  early: {
    id: "exchange-early",
    url: "https://api.openai.com/v1/responses",
    body: { model: "test-model", input: "early" },
  },
  first: {
    id: "exchange-first",
    url: "https://api.openai.com/v1/responses",
    body: { model: "test-model", input: "first" },
  },
  second: {
    id: "exchange-second",
    url: "https://api.openai.com/v1/responses",
    body: { model: "test-model", input: "second" },
  },
} as const

function sendNotification(socket: Bun.ServerWebSocket<undefined>, method: string, params: unknown) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
}

describe("OpenCode backend simulation transport", () => {
  it.live("preserves exact frames, sequential IDs, results, and finish defaults", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        sendResult(socket, request, request.method === "llm.attach" ? { attached: true } : { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })

      const results = [
        yield* connection.attach(),
        yield* connection.rpc["llm.chunk"]({
          id: "exchange-1",
          items: [
            { type: "textDelta", text: "answer" },
            { type: "reasoningDelta", text: "thinking" },
            {
              type: "toolCall",
              index: 0,
              id: "call-1",
              name: "read",
              input: { path: "README.md" },
            },
            { type: "raw", chunk: { usage: { outputTokens: 2 } } },
          ],
        }),
        yield* connection.rpc["llm.finish"]({ id: "exchange-1" }),
        yield* connection.rpc["llm.finish"]({ id: "exchange-2", reason: "stop" }),
        yield* connection.rpc["llm.finish"]({ id: "exchange-3", reason: "tool-calls" }),
        yield* connection.rpc["llm.finish"]({ id: "exchange-4", reason: "length" }),
        yield* connection.rpc["llm.finish"]({ id: "exchange-5", reason: "content-filter" }),
        yield* connection.rpc["llm.disconnect"]({ id: "exchange-6" }),
      ]

      expect(results).toEqual([
        { attached: true },
        { ok: true },
        { ok: true },
        { ok: true },
        { ok: true },
        { ok: true },
        { ok: true },
        { ok: true },
      ])

      const frames = [
        { jsonrpc: "2.0", id: 1, method: "llm.attach" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: {
            id: "exchange-1",
            items: [
              { type: "textDelta", text: "answer" },
              { type: "reasoningDelta", text: "thinking" },
              {
                type: "toolCall",
                index: 0,
                id: "call-1",
                name: "read",
                input: { path: "README.md" },
              },
              { type: "raw", chunk: { usage: { outputTokens: 2 } } },
            ],
          },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "llm.finish",
          params: { id: "exchange-1" },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "llm.finish",
          params: { id: "exchange-2", reason: "stop" },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "llm.finish",
          params: { id: "exchange-3", reason: "tool-calls" },
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "llm.finish",
          params: { id: "exchange-4", reason: "length" },
        },
        {
          jsonrpc: "2.0",
          id: 7,
          method: "llm.finish",
          params: { id: "exchange-5", reason: "content-filter" },
        },
        {
          jsonrpc: "2.0",
          id: 8,
          method: "llm.disconnect",
          params: { id: "exchange-6" },
        },
      ]

      expect(peer.received.map(({ raw }) => raw)).toEqual(frames.map((frame) => JSON.stringify(frame)))
      expect(peer.received.map(({ request }) => request)).toEqual(frames)

      expect(Backend.decodeRequest(peer.received[2]!.request)).toEqual({
        jsonrpc: "2.0",
        id: 3,
        method: "llm.finish",
        params: { id: "exchange-1", reason: "stop" },
      })
      expect(peer.received[2]!.raw).toBe(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "llm.finish",
          params: { id: "exchange-1" },
        }),
      )
    }),
  )

  it.live("delivers an llm.request sent before the attach response", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        sendNotification(socket, "llm.request", exchanges.early)
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connection = yield* SimulationConnector.backend(peer.url)
      const request = yield* Stream.runHead(connection.requests)
      expect(request).toEqual(Option.some(exchanges.early))
    }),
  )

  it.live("preserves notification order and ignores unknown notifications without consuming response waiters", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "llm.attach") {
          sendResult(socket, request, { attached: true })
          return
        }
        sendNotification(socket, "llm.request", exchanges.first)
        sendNotification(socket, "server.status", { ready: true })
        sendNotification(socket, "llm.request", exchanges.second)
        sendResult(socket, request, { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connection = yield* SimulationConnector.backend(peer.url)
      expect(
        yield* connection.rpc["llm.chunk"]({
          id: "exchange-1",
          items: [{ type: "textDelta", text: "response" }],
        }),
      ).toEqual({ ok: true })
      const received = yield* connection.requests.pipe(Stream.take(2), Stream.runCollect)
      expect([...received]).toEqual([exchanges.first, exchanges.second])
    }),
  )

  it.live("mirrors tool lifecycle RPCs and preserves invocation-cancellation order", () =>
    Effect.gen(function* () {
      const invocation = {
        id: "tool_1",
        name: "lookup",
        input: { query: "meaning" },
        context: {
          sessionID: "ses_tools",
          agent: "build",
          messageID: "msg_tools",
          callID: "call_lookup",
        },
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          sendNotification(socket, "tool.invocation", invocation)
          sendNotification(socket, "tool.cancel", {
            id: "tool_1",
            reason: "interrupted",
          })
          sendResult(socket, request, { attached: true })
          return
        }
        sendResult(socket, request, { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const events = yield* connection.toolEvents.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      )
      const tools = [
        {
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object" },
          options: { codemode: false },
        },
      ]

      yield* connection.attachTools(tools)
      yield* connection.updateTool({
        id: "tool_1",
        sequence: 0,
        update: { structured: { phase: "searching" } },
      })
      yield* connection.finishTool({
        id: "tool_1",
        output: { structured: { answer: 42 }, content: [] },
      })
      yield* connection.failTool({ id: "tool_2", message: "failed" })

      expect([...(yield* Fiber.join(events))]).toEqual([
        { type: "invocation", invocation },
        {
          type: "cancellation",
          cancellation: { id: "tool_1", reason: "interrupted" },
        },
      ])
      expect(peer.received.map(({ request }) => request)).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tool.attach",
          params: { tools },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tool.update",
          params: {
            id: "tool_1",
            sequence: 0,
            update: { structured: { phase: "searching" } },
          },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tool.finish",
          params: {
            id: "tool_1",
            output: { structured: { answer: 42 }, content: [] },
          },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tool.fail",
          params: { id: "tool_2", message: "failed" },
        },
      ])
    }),
  )
})
