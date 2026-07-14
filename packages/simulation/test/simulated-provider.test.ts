import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Queue, Stream } from "effect"
import type { Scope } from "effect/Scope"
import { SimulatedProvider } from "../src/backend/simulated-provider"
import { availableEndpoint, connect } from "./fixture/websocket"

test("streams a Drive-controlled provider response and removes the finished invocation", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      socket.send("{")
      expect(yield* Queue.take(messages)).toMatchObject({ id: null, error: { code: -32000 } })
      yield* attach(socket, messages)

      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)

      const opened = yield* takeInvocation(messages)
      expect(opened).toMatchObject({
        method: "llm.request",
        params: {
          url: "https://api.openai.com/v1/chat/completions",
          body: { model: "gpt-5" },
        },
      })
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")
      expect(response.pollUnsafe()).toBeUndefined()

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: { id: params.id, items: [{ type: "textDelta", text: "Hello from Drive" }] },
        }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "llm.finish",
          params: { id: params.id, reason: "stop" },
        }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 3, result: { ok: true } })

      expect(Array.from(yield* Fiber.join(response))).toEqual([
        { type: "textDelta", text: "Hello from Drive" },
        { type: "finish", reason: "stop" },
      ])

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "llm.pending" }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 4, result: { invocations: [] } })
    }),
  )
})

test("replays an invocation to a controller that attaches after it opens", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "llm.attach" }))
      const received = [requireRecord(yield* Queue.take(messages)), requireRecord(yield* Queue.take(messages))]
      expect(received).toContainEqual(expect.objectContaining({ id: 1, result: { attached: true } }))
      const opened = received.find((message) => message.method === "llm.request")
      if (!opened) throw new Error("The pending invocation was not replayed")
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.finish", params: { id: params.id, reason: "stop" } }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(Array.from(yield* Fiber.join(response))).toEqual([{ type: "finish", reason: "stop" }])
    }),
  )
})

test("replaces the previous attached controller", async () => {
  const endpoint = availableEndpoint()
  await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* SimulatedProvider.Service
      const first = yield* connect(endpoint)
      const second = yield* connect(endpoint)
      const firstMessages = yield* messagesFrom(first)
      const secondMessages = yield* messagesFrom(second)

      yield* attach(first, firstMessages)
      yield* attach(second, secondMessages)
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)
      const opened = yield* takeInvocation(secondMessages)
      expect(yield* Queue.size(firstMessages)).toBe(0)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      second.send(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.finish", params: { id: params.id, reason: "stop" } }),
      )
      expect(yield* Queue.take(secondMessages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(Array.from(yield* Fiber.join(response))).toEqual([{ type: "finish", reason: "stop" }])
    }).pipe(Effect.provide(SimulatedProvider.layerDrive({ endpoint })), Effect.scoped),
  )
})

test("removes an invocation when its response stream is interrupted", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const response = yield* provider.stream(request).pipe(Stream.runDrain, Effect.forkScoped)
      yield* takeInvocation(messages)

      yield* Fiber.interrupt(response)

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.pending" }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { invocations: [] } })
    }),
  )
})

test("releases a backpressured response when its consumer is interrupted", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const started = yield* Deferred.make<void>()
      const response = yield* provider.stream(request).pipe(
        Stream.runForEach(() => Deferred.succeed(started, void 0).pipe(Effect.andThen(Effect.never))),
        Effect.forkScoped,
      )
      const opened = yield* takeInvocation(messages)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: {
            id: params.id,
            items: Array.from({ length: 300 }, (_, index) => ({ type: "textDelta", text: String(index) })),
          },
        }),
      )
      const result = yield* Queue.take(messages).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(result.pollUnsafe()).toBeUndefined()

      yield* Fiber.interrupt(response)
      expect(yield* Fiber.join(result)).toMatchObject({ id: 2 })
    }),
  )
})

test("fails the provider stream when Drive disconnects the invocation", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.flip, Effect.forkScoped)
      const opened = yield* takeInvocation(messages)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.disconnect", params: { id: params.id } }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(yield* Fiber.join(response)).toBeInstanceOf(SimulatedProvider.ProviderDisconnectedError)
    }),
  )
})

const request: SimulatedProvider.ProviderRequest = {
  url: "https://api.openai.com/v1/chat/completions",
  body: { model: "gpt-5", messages: [{ role: "user", content: "Hello" }] },
}

function runProvider<E>(
  body: (
    provider: SimulatedProvider.Interface,
    socket: WebSocket,
    messages: Queue.Queue<unknown>,
  ) => Effect.Effect<void, E, Scope>,
) {
  const endpoint = availableEndpoint()
  return Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* SimulatedProvider.Service
      const socket = yield* connect(endpoint)
      const messages = yield* messagesFrom(socket)
      yield* body(provider, socket, messages)
    }).pipe(Effect.provide(SimulatedProvider.layerDrive({ endpoint })), Effect.scoped),
  )
}

function messagesFrom(socket: WebSocket) {
  return Effect.gen(function* () {
    const messages = yield* Queue.unbounded<unknown>()
    socket.addEventListener("message", (event) => {
      Queue.offerUnsafe(messages, JSON.parse(String(event.data)))
    })
    return messages
  })
}

function attach(socket: WebSocket, messages: Queue.Queue<unknown>) {
  return Effect.gen(function* () {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "llm.attach" }))
    expect(yield* Queue.take(messages)).toMatchObject({ id: 1, result: { attached: true } })
  })
}

function takeInvocation(messages: Queue.Queue<unknown>) {
  return Queue.take(messages).pipe(
    Effect.map((message) => {
      const opened = requireRecord(message)
      if (opened.method !== "llm.request") throw new Error("Expected an llm.request notification")
      return opened
    }),
  )
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected an object")
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
