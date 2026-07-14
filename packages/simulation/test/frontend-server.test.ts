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

        socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ui.state" }))
        expect(yield* Queue.take(messages)).toMatchObject({
          id: 1,
          result: { focused: { editor: false }, elements: [] },
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
