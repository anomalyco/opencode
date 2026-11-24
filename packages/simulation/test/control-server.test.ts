import { expect, test } from "bun:test"
import { Effect, Queue, Schema } from "effect"
import { SimulationControlServer } from "../src/control-server"
import { connect } from "./fixture/websocket"

const Request = Schema.Struct({ id: Schema.optional(Schema.Number) })
// Port 0 asks the kernel for one, and the server reports the address it bound; nothing can take it in between.
const endpoint = "ws://127.0.0.1:0"

test("awaits accepted socket cleanup before the server scope closes", async () => {
  let cleaned = false

  const bound = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* SimulationControlServer.start({
          endpoint,
          label: "control server test",
          data: () => ({}),
          decode: Schema.decodeUnknownEffect(Schema.fromJsonString(Request)),
          handle: () => Effect.succeed({ ok: true }),
          close: () =>
            Effect.promise(async () => {
              await Bun.sleep(25)
              cleaned = true
            }),
        })
        yield* connect(server.url)
        return server.url
      }),
    ),
  )

  expect(cleaned).toBe(true)
  const url = new URL(bound)
  const rebound = Bun.serve({ hostname: url.hostname, port: Number(url.port), fetch: () => new Response() })
  await rebound.stop(true)
})

test("continues serving after a response targets a closed socket", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* SimulationControlServer.start({
          endpoint,
          label: "control server test",
          data: () => ({}),
          decode: Schema.decodeUnknownEffect(Schema.fromJsonString(Request)),
          handle: () => Effect.sleep(25).pipe(Effect.as({ ok: true })),
        })
        const closed = yield* connect(server.url)
        closed.send(JSON.stringify({ id: 1 }))
        closed.close()
        yield* Effect.sleep(50)

        const socket = yield* connect(server.url)
        const messages = yield* Queue.unbounded<unknown>()
        socket.addEventListener("message", (event) => Queue.offerUnsafe(messages, JSON.parse(String(event.data))))
        socket.send(JSON.stringify({ id: 2 }))
        expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })
      }),
    ),
  )
})

test("disconnects and cleans up when an outbound message exceeds the queue bound", async () => {
  let cleaned = false
  let delivered = false

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* SimulationControlServer.start({
          endpoint,
          label: "control server test",
          data: () => ({}),
          decode: Schema.decodeUnknownEffect(Schema.fromJsonString(Request)),
          handle: (socket) =>
            Effect.gen(function* () {
              yield* socket.send("x".repeat(64 * 1024 * 1024 + 1))
              delivered = true
              return { ok: true }
            }),
          close: () => Effect.sync(() => void (cleaned = true)),
        })
        const socket = yield* connect(server.url)
        const closed = yield* Queue.unbounded<void>()
        const messages: string[] = []
        socket.addEventListener("close", () => Queue.offerUnsafe(closed, undefined))
        socket.addEventListener("message", (event) => messages.push(String(event.data)))
        socket.send(JSON.stringify({ id: 1 }))
        yield* Queue.take(closed).pipe(Effect.timeout("5 seconds"))

        expect(cleaned).toBe(true)
        expect(delivered).toBe(false)
        expect(messages).toEqual([])
      }),
    ),
  )
})
