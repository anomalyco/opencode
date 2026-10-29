import { Effect, Queue } from "effect"
import { Socket } from "effect/socket"

export type Outbound = string | Uint8Array | Socket.CloseEvent

// Outbound frames flow through one queue drained by a single writer so replay, live output, and the close
// frame keep their order. Either side closing ends the connection normally, and every exit detaches.
export function runPtySocket<R>(input: {
  readonly socket: Socket.Socket
  readonly outbox: Queue.Dequeue<Outbound>
  readonly onOpen?: Effect.Effect<void, never, R>
  readonly onMessage: (message: string | Uint8Array) => Effect.Effect<void, never, R>
  readonly detach: () => void
}) {
  const drain = Effect.gen(function* () {
    const writer = yield* input.socket.writer
    while (true) {
      const item = yield* Queue.take(input.outbox)
      yield* writer.write(item)
      if (item instanceof Socket.CloseEvent) return
    }
  })
  const read = Effect.gen(function* () {
    const reader = yield* input.socket.reader
    if (input.onOpen) yield* input.onOpen
    while (true) yield* Effect.forEach(yield* reader.pull, input.onMessage, { discard: true })
  })
  return Effect.raceFirst(drain, read).pipe(
    Effect.ensuring(Effect.sync(input.detach)),
    Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
    Effect.orDie,
  )
}
