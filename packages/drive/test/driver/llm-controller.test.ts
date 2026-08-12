import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import * as LlmController from "../../src/driver/llm-controller.js"
import * as Llm from "../../src/llm/index.js"
import * as SimulationConnector from "../../src/simulation/connector.js"
import { sendError, sendResult, startTransportPeer } from "../simulation/transport-peer.js"

const request = {
  id: "exchange-1",
  url: "https://api.openai.com/v1/responses",
  body: { model: "test-model" },
}

describe("LlmController", () => {
  it.live("preserves response state across backend generations", () => {
    const peer = (id: string) =>
      startTransportPeer(({ request: frame, socket }) => {
        if (frame.method === "llm.attach")
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "llm.request",
              params: { ...request, id },
            }),
          )
        sendResult(
          socket,
          frame,
          frame.method === "llm.attach" ? { attached: true } : { ok: true },
        )
      })
    const first = peer("generation-1")
    const second = peer("generation-2")

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => Promise.all([first.stop(), second.stop()])),
      )
      const llm = yield* LlmController.make()
      const firstBackend = yield* SimulationConnector.backend(first.url)
      const firstAttachment = yield* llm.attach(firstBackend)
      yield* llm.send(Llm.text("first", { delay: 0 }))
      yield* firstAttachment.detach()

      const secondBackend = yield* SimulationConnector.backend(second.url)
      yield* llm.attach(secondBackend)
      yield* llm.send(Llm.text("second", { delay: 0 }))
      yield* llm.settle()

      expect(
        first.received.some(({ request: frame }) =>
          JSON.stringify(frame).includes("first"),
        ),
      ).toBe(true)
      expect(
        second.received.some(({ request: frame }) =>
          JSON.stringify(frame).includes("second"),
        ),
      ).toBe(true)
    })
  })

  it.live("queues and streams one future response", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(Llm.text("hello", { delay: 0, chunkSize: 100 }), Llm.finish("length"))
      yield* llm.settle()

      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "llm.attach" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: {
            id: "exchange-1",
            items: [{ type: "textDelta", text: "hello" }],
          },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "llm.finish",
          params: { id: "exchange-1", reason: "length" },
        },
      ])
    })
  })

  it.live("streams tool call input as provider-neutral deltas", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5)
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => random.mockRestore()))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(
        Llm.toolCall(
          {
            index: 0,
            id: "call_1",
            name: "lookup",
            input: { query: "weather" },
          },
          { delay: 0, chunkSize: 10 },
        ),
        Llm.finish("tool-calls"),
      )
      yield* llm.settle()

      const chunks = peer.received
        .map(({ request: frame }) => frame)
        .filter((frame) => frame.method === "llm.chunk")
      expect(chunks).toEqual([
        expect.objectContaining({
          params: {
            id: "exchange-1",
            items: [
              {
                type: "toolInputStart",
                index: 0,
                id: "call_1",
                name: "lookup",
              },
            ],
          },
        }),
        expect.objectContaining({
          params: {
            id: "exchange-1",
            items: [
              {
                type: "toolInputDelta",
                index: 0,
                text: '{"query":"',
              },
            ],
          },
        }),
        expect.objectContaining({
          params: {
            id: "exchange-1",
            items: [
              {
                type: "toolInputDelta",
                index: 0,
                text: 'weather"}',
              },
            ],
          },
        }),
      ])
    })
  })

  it.live("falls back to OpenAI deltas when partial tool input is unavailable", () => {
    const peer = startTransportPeer(
      ({ request: frame, socket }) => {
        if (frame.method === "llm.attach")
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "llm.request",
              params: request,
            }),
          )
        sendResult(
          socket,
          frame,
          frame.method === "llm.attach" ? { attached: true } : { ok: true },
        )
      },
      {
        capabilities: (offered) =>
          offered.filter((capability) => capability !== "llm.tool-input-delta"),
      },
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(
        Llm.toolCall(
          {
            index: 0,
            id: "call_legacy",
            name: "lookup",
            input: { query: "weather" },
          },
          { delay: 0, chunkSize: 100 },
        ),
        Llm.finish("tool-calls"),
      )
      yield* llm.settle()

      const chunk = peer.received.find(
        ({ request: frame }) => frame.method === "llm.chunk",
      )?.request
      expect(chunk).toMatchObject({
        params: {
          id: "exchange-1",
          items: [
            {
              type: "raw",
              chunk: {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_legacy",
                          function: {
                            name: "lookup",
                            arguments: '{"query":"weather"}',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      })
    })
  })

  it.live("serves requests and keeps titles outside normal sequencing", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5)
    const titleRequest = {
      ...request,
      id: "title-1",
      body: {
        messages: [
          {
            role: "system",
            content: "You are a title generator. Generate a title.",
          },
        ],
      },
    }
    const chunksSent = Promise.withResolvers<void>()
    let chunkCount = 0
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.chunk" && ++chunkCount === 2) chunksSent.resolve()
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => random.mockRestore()))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.title(() => Effect.succeed("A concise title"))
      yield* llm.serve(() => LlmController.response(Llm.text("served", { delay: 0, chunkSize: 100 })))
      const attached = peer.received[0]
      if (attached === undefined)
        return yield* Effect.dieMessage("llm.attach was not received")
      const socket = attached.socket
      for (const params of [titleRequest, request])
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params,
          }),
        )
      yield* Effect.promise(() => chunksSent.promise)
      yield* llm.settle()

      const chunks = peer.received.map(({ request }) => request).filter((frame) => frame.method === "llm.chunk")
      expect(chunks).toHaveLength(2)
      expect(chunks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            params: {
              id: "title-1",
              items: [{ type: "textDelta", text: "A concise title" }],
            },
          }),
          expect.objectContaining({
            params: {
              id: "exchange-1",
              items: [{ type: "textDelta", text: "served" }],
            },
          }),
        ]),
      )
    })
  })

  it.live("fails settlement for output after a terminal event", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(Llm.finish(), Llm.text("too late", { delay: 0 }))
      const error = yield* llm.settle().pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "LlmControllerError",
        operation: "respond",
        requestId: "exchange-1",
      })
      expect(error.message).toContain("after its terminal event")
    })
  })

  it.live("settles when pending confirms an invocation was terminated externally", () => {
    let chunks = 0
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach") {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
        return sendResult(socket, frame, { attached: true })
      }
      if (frame.method === "llm.chunk" && ++chunks === 2)
        return sendError(socket, frame, "Simulated provider invocation not found or already finished: exchange-1")
      if (frame.method === "llm.pending")
        return sendResult(socket, frame, { invocations: [] })
      sendResult(socket, frame, { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(
        Llm.text("first", { delay: 0, chunkSize: 100 }),
        Llm.text("second", { delay: 0, chunkSize: 100 }),
      )
      yield* llm.settle()

      expect(peer.received.map(({ request: frame }) => frame.method)).toEqual([
        "llm.attach",
        "llm.chunk",
        "llm.chunk",
        "llm.pending",
      ])
    })
  })

  it.live("preserves a write failure while the invocation is still pending", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach") {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
        return sendResult(socket, frame, { attached: true })
      }
      if (frame.method === "llm.chunk") return sendError(socket, frame, "chunk rejected")
      if (frame.method === "llm.pending")
        return sendResult(socket, frame, { invocations: [request] })
      sendResult(socket, frame, { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.queue(Llm.text("rejected", { delay: 0, chunkSize: 100 }))
      const error = yield* llm.settle().pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "LlmControllerError",
        operation: "llm.chunk",
        requestId: "exchange-1",
      })
      expect(error.message).toContain("chunk rejected")
    })
  })

  it.effect("reports unused queued responses at settlement", () => {
    const peer = startTransportPeer(({ request: frame, socket }) =>
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true }),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend, {
        settlementTimeout: 20,
      })
      yield* llm.queue(Llm.text("unused"))
      const settlement = yield* Effect.forkChild(llm.settle().pipe(Effect.flip))
      yield* TestClock.adjust(20)
      const error = yield* Fiber.join(settlement)
      expect(error).toBeInstanceOf(LlmController.LlmSettlementError)
      expect(error).toMatchObject({
        unusedResponses: 1,
        unexpectedRequests: 0,
      })
    })
  })

  it.live("send waits until its response is accepted", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.send(Llm.raw({ accepted: true }))
      yield* llm.settle()
      expect(peer.received.some(({ request }) => request.method === "llm.finish")).toBe(true)
    })
  })

  it.live("serves a request that arrived before serve mode was selected", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* Effect.yieldNow
      yield* llm.serve(() =>
        LlmController.response(
          Llm.text("late serve", { delay: 0, chunkSize: 100 }),
        ),
      )
      yield* llm.settle()
      expect(
        peer.received.some(
          ({ request }) =>
            request.method === "llm.chunk" &&
            JSON.stringify(request.params).includes("late serve"),
        ),
      ).toBe(true)
    })
  })

  it.live("reports defects thrown by serve handlers", () => {
    const peer = startTransportPeer(({ request: frame, socket }) => {
      if (frame.method === "llm.attach")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: request,
          }),
        )
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true })
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* llm.serve(() => {
        throw new Error("serve exploded")
      })
      const failure = yield* llm.settle().pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "LlmControllerError",
        operation: "respond",
        requestId: "exchange-1",
      })
      expect(failure.message).toContain("serve exploded")
    })
  })

  it.live("fails a pending send when the controller shuts down", () => {
    const peer = startTransportPeer(({ request: frame, socket }) =>
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true }),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      const sending = yield* Effect.forkChild(
        llm.send(Llm.text("pending")).pipe(Effect.flip),
      )
      yield* Effect.yieldNow
      yield* llm.shutdown()
      const failure = yield* Fiber.join(sending)
      expect(failure).toMatchObject({
        _tag: "LlmControllerError",
        operation: "shutdown",
      })
    })
  })

  it.live("fails when the backend connection closes unexpectedly", () => {
    const peer = startTransportPeer(({ request: frame, socket }) =>
      sendResult(socket, frame, frame.method === "llm.attach" ? { attached: true } : { ok: true }),
    )

    return Effect.gen(function* () {
      const backend = yield* SimulationConnector.backend(peer.url)
      const llm = yield* LlmController.make(backend)
      yield* Effect.promise(() => peer.stop())
      yield* backend.closed
      yield* Effect.yieldNow
      const failure = yield* llm.settle().pipe(Effect.flip)
      expect(failure).toMatchObject({
        _tag: "LlmControllerError",
        operation: "backend",
      })
    })
  })
})
