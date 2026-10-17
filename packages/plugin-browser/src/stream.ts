export * as BrowserStream from "./stream.js"

import { Duplex } from "node:stream"
import { Deferred, Effect, Latch } from "effect"
import { Socket } from "effect/socket"

export const FRAME_BYTES = 64 * 1024
export const WINDOW_BYTES = 1024 * 1024
// Binary opcodes: 0 = bytes, 1 = ready, 2 = half-close, 3 = consumed bytes (uint32 BE).

/** Opens a stream whose scope lasts until the stream closes or the signal aborts. */
export function open<E>(socket: Effect.Effect<Socket.Socket, E>, signal: AbortSignal) {
  const opened = Promise.withResolvers<Duplex>()
  void Effect.runPromise(
    Effect.gen(function* () {
      const connection = yield* socket
      const tunnel = yield* make(connection)
      opened.resolve(tunnel.stream)
      yield* tunnel.closed
    }).pipe(Effect.scoped),
    { signal },
  ).catch(opened.reject)
  return opened.promise
}

/** A bounded, full-duplex byte stream. Credits acknowledge consumption, not individual frames. */
export const make = Effect.fn("BrowserStream.make")(function* (socket: Socket.Socket) {
  const reader = yield* socket.reader
  const writer = yield* socket.writer
  const ready = yield* Deferred.make<void, Error>()
  const closed = yield* Deferred.make<void>()
  const credit = yield* Latch.make(true)
  const abort = new AbortController()
  let sending = WINDOW_BYTES
  let receiving = WINDOW_BYTES
  let consumed = 0
  let started = false
  let ended = false
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { signal: abort.signal })
  const complete = (effect: Effect.Effect<void, Socket.SocketError>, callback: (error?: Error | null) => void) => {
    void run(effect).then(
      () => callback(),
      (error: unknown) => callback(asError(error)),
    )
  }
  const acknowledge = () => {
    if (consumed < WINDOW_BYTES / 4) return
    const bytes = consumed
    consumed = 0
    receiving += bytes
    const frame = new Uint8Array(5)
    frame[0] = 3
    new DataView(frame.buffer).setUint32(1, bytes)
    void run(writer.write(frame)).catch((error: unknown) => stream.destroy(asError(error)))
  }
  const stream = new Duplex({
    highWaterMark: FRAME_BYTES,
    allowHalfOpen: true,
    read() {
      acknowledge()
    },
    write(data: Buffer, _encoding, callback) {
      complete(
        Effect.gen(function* () {
          for (let offset = 0; offset < data.byteLength; ) {
            if (!sending) yield* credit.await
            const size = Math.min(data.byteLength - offset, FRAME_BYTES, sending)
            sending -= size
            if (!sending) credit.closeUnsafe()
            yield* writer.write(Buffer.concat([Buffer.from([0]), data.subarray(offset, offset + size)]))
            offset += size
          }
        }),
        callback,
      )
    },
    final(callback) {
      complete(writer.write(new Uint8Array([2])), callback)
    },
    destroy(error, callback) {
      abort.abort()
      void Effect.runPromise(writer.write(new Socket.CloseEvent(error ? 1011 : 1000)))
        .catch(() => undefined)
        .then(() => callback(error))
      Effect.runSync(Deferred.succeed(closed, undefined))
      Effect.runSync(Deferred.fail(ready, error ?? new Error("Browser stream closed before ready.")))
    },
  })
  stream.on("error", () => stream.destroy())
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stream.destroy()
    }),
  )
  yield* Effect.gen(function* () {
    while (true) {
      const frames = yield* reader.pull
      yield* Effect.try({
        try: () => {
          frames.forEach((frame) => {
            if (typeof frame === "string" || !frame.byteLength) throw new Error("Invalid browser stream frame.")
            if (frame[0] !== 0) {
              if (frame[0] === 1 && frame.byteLength === 1) {
                if (started) throw new Error("Duplicate browser stream handshake.")
                started = true
                Effect.runSync(Deferred.succeed(ready, undefined))
                return
              }
              if (!started) throw new Error("Browser stream is not ready.")
              if (frame[0] === 2 && frame.byteLength === 1) {
                if (ended) throw new Error("Browser stream already ended.")
                ended = true
                stream.push(null)
                return
              }
              if (frame[0] !== 3 || frame.byteLength !== 5) throw new Error("Invalid browser stream control.")
              const bytes = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1)
              if (!bytes || sending + bytes > WINDOW_BYTES) throw new Error("Invalid browser stream credit.")
              sending += bytes
              credit.openUnsafe()
              return
            }
            const data = frame.subarray(1)
            if (!started || ended || !data.byteLength || data.byteLength > FRAME_BYTES || data.byteLength > receiving)
              throw new Error("Invalid browser stream frame.")
            receiving -= data.byteLength
            consumed += data.byteLength
            if (stream.push(data)) acknowledge()
          })
        },
        catch: asError,
      })
    }
  }).pipe(
    Effect.raceFirst(Deferred.await(closed)),
    Effect.catch((error) =>
      Effect.sync(() => {
        stream.destroy(asError(error))
      }),
    ),
    Effect.forkScoped,
  )
  yield* writer.write(new Uint8Array([1]))
  yield* Deferred.await(ready).pipe(Effect.timeout("10 seconds"))
  return { stream, closed: Deferred.await(closed) }
})

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
