import { expect } from "bun:test"
import { Server } from "node:http"
import { once } from "node:events"
import { NodeHttpServer, NodeSocket } from "@effect/platform-node"
import { Deferred, Effect } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { it } from "../../core/test/lib/effect"
import { BrowserStream } from "../src/stream.js"

it.live("a paused consumer bounds buffered bytes and resumes a writer when it drains", () =>
  Effect.gen(function* () {
    const connection = yield* pair()
    const bytes = Buffer.alloc(BrowserStream.WINDOW_BYTES * 3, 143)
    const sent = yield* Deferred.make<void>()
    connection.left.stream.end(bytes, () => {
      Effect.runSync(Deferred.succeed(sent, undefined))
    })
    while (connection.right.stream.readableLength < BrowserStream.WINDOW_BYTES) yield* Effect.sleep("1 millis")
    expect(yield* Deferred.isDone(sent)).toBe(false)
    expect(connection.right.stream.readableLength).toBeLessThanOrEqual(BrowserStream.WINDOW_BYTES)
    const received = yield* Effect.promise(async () => {
      const chunks: Buffer[] = []
      connection.right.stream.on("data", (chunk) => chunks.push(chunk))
      await once(connection.right.stream, "end")
      return Buffer.concat(chunks)
    })
    yield* Deferred.await(sent)
    expect(received).toEqual(bytes)
    connection.right.stream.end()
    connection.left.stream.resume()
    yield* connection.left.closed
  }),
)

for (const frame of [
  new Uint8Array(),
  new Uint8Array([1]),
  new Uint8Array([9]),
  new Uint8Array([3, 0, 0, 0, 1]),
  new Uint8Array([3, 0, 0, 0, 0]),
  new Uint8Array(BrowserStream.FRAME_BYTES + 2),
]) {
  it.live(`invalid frame ${frame[0] ?? "empty"}/${frame.byteLength} closes the stream`, () =>
    Effect.gen(function* () {
      const connection = yield* pair()
      yield* connection.writer.write(frame)
      yield* connection.right.closed
      expect(connection.right.stream.errored).not.toBeNull()
    }),
  )
}

it.live("TCP data after half-close is rejected", () =>
  Effect.gen(function* () {
    const connection = yield* pair()
    yield* connection.writer.write(new Uint8Array([2]))
    yield* connection.writer.write(new Uint8Array([0, 1]))
    yield* connection.right.closed
    expect(connection.right.stream.errored).not.toBeNull()
  }),
)

const pair = Effect.fn(function* () {
  const ready = yield* Deferred.make<Effect.Success<ReturnType<typeof BrowserStream.make>>>()
  const http = yield* NodeHttpServer.make(() => new Server(), { port: 0, host: "127.0.0.1" })
  yield* http
    .serve(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const socket = yield* request.upgrade
        const stream = yield* BrowserStream.make(socket)
        yield* Deferred.succeed(ready, stream)
        yield* stream.closed
        return HttpServerResponse.empty()
      }).pipe(Effect.orDie),
    )
    .pipe(Effect.provide(NodeHttpServer.layerHttpServices))
  const socket = yield* Socket.makeWebSocket(HttpServer.formatAddress(http.address).replace("http:", "ws:")).pipe(
    Effect.provide(NodeSocket.layerWebSocketConstructorWS),
  )
  const left = yield* BrowserStream.make(socket)
  const writer = yield* socket.writer
  const right = yield* Deferred.await(ready)
  return { left, right, writer }
})
