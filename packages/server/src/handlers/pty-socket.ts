import { LocationLifecycle } from "@opencode/core/location-lifecycle"
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

// A socket borrows its Location for as long as it stays open. Its client reconnects right away when the socket
// closes, so it keeps the idle sweep from evicting the Location (eviction would only boot a fresh one). Any other
// shutdown (reload, VCS init, debug eviction) closes the socket with 1012, which releases the borrow so the
// Location's scope can close, and the client reconnects to the replacement.
export const holdLocation = Effect.fnUntraced(function* (outbox: Queue.Enqueue<Outbound>) {
  const lifecycle = yield* LocationLifecycle.Service
  yield* lifecycle.retain
  yield* lifecycle.awaitShutdown.pipe(
    Effect.andThen(Queue.offer(outbox, new Socket.CloseEvent(1012, "location shut down"))),
    Effect.forkChild,
  )
})
