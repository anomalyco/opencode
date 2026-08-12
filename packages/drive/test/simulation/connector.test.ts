import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema, Stream } from "effect"
import { SimulationConnector } from "../../src/simulation/connector.js"
import { sendError, sendResult, startTransportPeer } from "./transport-peer.js"

const state = {
  focused: { renderable: 1, editor: true },
  elements: [],
}

describe("SimulationConnector", () => {
  it.live("acquires a generated UI client through the service seam", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, state))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connector = yield* SimulationConnector.Service
      const connection = yield* connector.ui(peer.url)

      expect(connection.endpoint).toBe(peer.url)
      expect(connection.compatibility).toMatchObject({
        _tag: "Negotiated",
        role: "ui",
        protocolVersion: 1,
        server: { name: "opencode", version: "test" },
      })
      expect(yield* connection.rpc["ui.state"]()).toEqual(state)
      expect(peer.received.map(({ request }) => request)).toEqual([{ jsonrpc: "2.0", id: 1, method: "ui.state" }])
    }).pipe(Effect.provide(SimulationConnector.layer)),
  )

  it.live("reports legacy fallback and rejects it when negotiation is required", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(
        ({ request, socket }) =>
          request.method === "simulation.handshake"
            ? sendError(socket, request, "method not found", -32601)
            : sendResult(socket, request, state),
        { handshake: false },
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connector = yield* SimulationConnector.Service
      const legacy = yield* connector.ui(peer.url)
      expect(legacy.compatibility).toMatchObject({
        _tag: "Legacy",
        role: "ui",
        profile: "opencode-simulation-jsonrpc-v0",
      })

      const error = yield* connector.ui(peer.url, {
        compatibility: "required",
      }).pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "SimulationCompatibilityError",
        endpoint: peer.url,
        role: "ui",
      })
    }).pipe(Effect.provide(SimulationConnector.layer)),
  )

  it.live("attaches after installing a validated backend request stream", () =>
    Effect.gen(function* () {
      const exchange = {
        id: "exchange-1",
        url: "https://api.openai.com/v1/responses",
        body: { model: "test-model" },
      }
      const peer = startTransportPeer(({ request, socket }) => {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: exchange,
          }),
        )
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connector = yield* SimulationConnector.Service
      const connection = yield* connector.backend(peer.url)
      const request = yield* Stream.runHead(connection.requests)
      const output = { endpoint: connection.endpoint, request }

      expect(output.endpoint).toBe(peer.url)
      expect(output.request).toEqual(Option.some(exchange))
      expect(peer.received.map(({ request }) => request)).toEqual([{ jsonrpc: "2.0", id: 1, method: "llm.attach" }])
    }).pipe(Effect.provide(SimulationConnector.layer)),
  )

  it.live("fails the backend request stream for invalid llm.request payloads", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: { id: 1 },
          }),
        )
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connector = yield* SimulationConnector.Service
      const connection = yield* connector.backend(peer.url)
      const error = yield* Stream.runHead(connection.requests).pipe(Effect.flip)
      expect(Schema.isSchemaError(error)).toBe(true)
    }).pipe(Effect.provide(SimulationConnector.layer)),
  )

  it.live("keeps tool capabilities optional until dynamic tools are attached", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(
        ({ request, socket }) =>
          sendResult(
            socket,
            request,
            request.method === "llm.attach"
              ? { attached: true }
              : { ok: true },
          ),
        {
          capabilities: (offered) =>
            offered.filter((capability) => !capability.startsWith("tool.")),
        },
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))

      const connection = yield* SimulationConnector.backend(peer.url)
      expect(connection.compatibility).toMatchObject({
        _tag: "Negotiated",
        role: "backend",
      })
      expect(
        yield* connection.attachTools([]).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "SimulationCompatibilityError",
        role: "backend",
        message: expect.stringContaining("tool.attach"),
      })
      expect(peer.received.map(({ request }) => request.method)).toEqual([
        "llm.attach",
      ])
    }).pipe(Effect.provide(SimulationConnector.layer)),
  )
})
