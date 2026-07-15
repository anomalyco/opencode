import { expect, test } from "bun:test"
import { Effect, FileSystem, Queue } from "effect"
import { SimulationActions } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"
import { SimulationServer } from "../src/frontend/server"
import { availableEndpoint, connect } from "./fixture/websocket"

test("scopes the frontend control server and reports malformed JSON", async () => {
  const endpoint = availableEndpoint()

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const renderer = yield* SimulationRenderer.create({})
        yield* SimulationServer.start(SimulationActions.createHarness(renderer), endpoint)
        const socket = yield* connect(endpoint)
        const messages = yield* Queue.unbounded<unknown>()
        socket.addEventListener("message", (event) => {
          Queue.offerUnsafe(messages, JSON.parse(String(event.data)))
        })

        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 0,
            method: "simulation.handshake",
            params: {
              client: { name: "test", version: "test" },
              expectedRole: "ui",
              offeredVersions: [1],
              requiredCapabilities: ["ui.state"],
              optionalCapabilities: [],
            },
          }),
        )
        expect(yield* Queue.take(messages)).toMatchObject({
          id: 0,
          result: {
            protocolVersion: 1,
            role: "ui",
            server: { name: "opencode", version: expect.any(String) },
            capabilities: expect.arrayContaining(["ui.state", "ui.capture"]),
          },
        })

        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ui.state" }))
        expect(yield* Queue.take(messages)).toMatchObject({
          id: 1,
          result: { focused: { editor: false }, elements: [] },
        })

        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ui.capture" }))
        expect(yield* Queue.take(messages)).toMatchObject({
          id: 2,
          result: {
            cols: 100,
            rows: 40,
            cursor: [0, 0],
            lines: expect.any(Array),
          },
        })

        socket.send("{")
        expect(yield* Queue.take(messages)).toMatchObject({
          id: null,
          error: { code: -32000 },
        })
      }),
    ).pipe(Effect.provide(FileSystem.layerNoop({}))),
  )

  const url = new URL(endpoint)
  const rebound = Bun.serve({ hostname: url.hostname, port: Number(url.port), fetch: () => new Response() })
  await rebound.stop(true)
})
