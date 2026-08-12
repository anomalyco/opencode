import { describe, expect, it, test } from "@effect/vitest"
import { Effect, Exit, Fiber, Scope } from "effect"
import {
  SimulationProtocol,
  defaultBackendPort,
  defaultPort,
} from "../../src/client/index.js"
import * as SimulationConnector from "../../src/simulation/connector.js"
import { type ReceivedRequest, sendError, sendResult, startTransportPeer } from "./transport-peer.js"

function captureRequests() {
  const queued: ReceivedRequest[] = []
  const waiters: Array<(request: ReceivedRequest) => void> = []

  return {
    onRequest(request: ReceivedRequest) {
      const waiter = waiters.shift()
      if (waiter === undefined) queued.push(request)
      else waiter(request)
    },
    next(): Promise<ReceivedRequest> {
      const request = queued.shift()
      if (request !== undefined) return Promise.resolve(request)
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

describe("OpenCode simulation transport lifecycle", () => {
  test("exports default ports and the protocol namespaces", () => {
    expect(defaultPort).toBe(40900)
    expect(defaultBackendPort).toBe(40950)
    expect(Object.keys(SimulationProtocol).sort()).toEqual([
      "Backend",
      "Frontend",
      "Handshake",
      "JsonRpc",
    ])
  })

  it.live("correlates concurrent UI responses by ID and ignores unknown IDs", () =>
    Effect.gen(function* () {
      const capture = captureRequests()
      const peer = startTransportPeer(capture.onRequest)
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const { rpc } = yield* SimulationConnector.ui(peer.url)
      const state = { focused: { renderable: 7, editor: true }, elements: [] }

      const stateResult = yield* Effect.forkChild(rpc["ui.state"]())
      const stateRequest = yield* Effect.promise(capture.next)
      const matchesResult = yield* Effect.forkChild(rpc["ui.matches"]({ text: "ready" }))
      const matchesRequest = yield* Effect.promise(capture.next)

      expect(stateRequest.request.method).toBe("ui.state")
      expect(matchesRequest.request.method).toBe("ui.matches")

      stateRequest.socket.send(JSON.stringify({ jsonrpc: "2.0", id: 999, result: "unknown" }))
      sendResult(matchesRequest.socket, matchesRequest.request, true)
      sendResult(stateRequest.socket, stateRequest.request, state)

      expect(yield* Fiber.join(matchesResult)).toBe(true)
      expect(yield* Fiber.join(stateResult)).toEqual(state)
    }),
  )

  it.live("maps JSON-RPC errors to SimulationRequestError with the originating method", () =>
    Effect.gen(function* () {
      const capture = captureRequests()
      const peer = startTransportPeer(capture.onRequest)
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const { rpc } = yield* SimulationConnector.ui(peer.url)

      const result = yield* Effect.forkChild(rpc["ui.matches"]({ text: "missing" }).pipe(Effect.flip))
      const received = yield* Effect.promise(capture.next)
      sendError(received.socket, received.request, "renderer unavailable")

      expect(yield* Fiber.join(result)).toMatchObject({
        _tag: "SimulationRequestError",
        message: "renderer unavailable",
        method: "ui.matches",
      })
    }),
  )

  it.live("peer close rejects every pending UI request", () =>
    Effect.gen(function* () {
      const capture = captureRequests()
      const peer = startTransportPeer(capture.onRequest)
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const { rpc } = yield* SimulationConnector.ui(peer.url)

      const stateResult = yield* Effect.forkChild(Effect.exit(rpc["ui.state"]()))
      yield* Effect.promise(capture.next)
      const matchesResult = yield* Effect.forkChild(Effect.exit(rpc["ui.matches"]({ text: "ready" })))
      yield* Effect.promise(capture.next)

      yield* Effect.promise(() => peer.stop())

      for (const exit of [yield* Fiber.join(stateResult), yield* Fiber.join(matchesResult)]) {
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("connection closed")
      }
    }),
  )

  it.live("backend closed resolves when its peer closes", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, { attached: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.backend(peer.url)

      yield* Effect.promise(() => peer.stop())
      yield* connection.closed
    }),
  )

  it.live("closing the connection scope rejects pending calls", () =>
    Effect.gen(function* () {
      const capture = captureRequests()
      const peer = startTransportPeer(capture.onRequest)
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const scope = yield* Scope.make()
      const { rpc } = yield* SimulationConnector.ui(peer.url).pipe(Scope.provide(scope))

      const pending = yield* Effect.forkChild(Effect.exit(rpc["ui.state"]()))
      yield* Effect.promise(capture.next)
      yield* Scope.close(scope, Exit.void)

      const exit = yield* Fiber.join(pending)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
