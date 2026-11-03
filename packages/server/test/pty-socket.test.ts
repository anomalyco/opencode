import { expect } from "bun:test"
import { Effect, Exit, Fiber, Queue } from "effect"
import { Socket } from "effect/socket"
import { it } from "../../core/test/lib/effect"
import { type Outbound, runPtySocket } from "../src/handlers/pty-socket"

const connection = Effect.gen(function* () {
  const inbound = yield* Queue.unbounded<string | Uint8Array, Socket.SocketError>()
  const outbox = yield* Queue.unbounded<Outbound>()
  const state = {
    opened: false,
    detached: false,
    received: [] as Array<string | Uint8Array>,
    written: [] as Outbound[],
  }
  const socket = Socket.make({
    reader: Effect.succeed({
      pull: Queue.take(inbound).pipe(Effect.map((message) => [message] as const)),
      upgrade: Socket.SocketUpgradeError.unsupported,
    }),
    writer: Effect.succeed({
      write: (chunk) => Effect.sync(() => void state.written.push(chunk)),
      writeAll: (chunks) => Effect.sync(() => void state.written.push(...chunks)),
    }),
  })
  const run = runPtySocket({
    socket,
    outbox,
    onOpen: Effect.sync(() => {
      state.opened = true
    }),
    onMessage: (message) =>
      Effect.sync(() => {
        expect(state.opened).toBeTrue()
        state.received.push(message)
      }),
    detach: () => {
      state.detached = true
    },
  })
  return { inbound, outbox, state, run }
})

const fail = (reason: Socket.SocketError["reason"]) => new Socket.SocketError({ reason })

it.live("delivers input in order and detaches when the client closes", () =>
  Effect.gen(function* () {
    const pty = yield* connection
    yield* Queue.offerAll(pty.inbound, ["a", "b"])
    yield* Queue.fail(pty.inbound, fail(new Socket.SocketCloseError({ code: 1000 })))

    expect(yield* Effect.exit(pty.run)).toEqual(Exit.void)
    expect(pty.state.received).toEqual(["a", "b"])
    expect(pty.state.detached).toBeTrue()
  }),
)

it.live("writes queued output through the close frame and detaches", () =>
  Effect.gen(function* () {
    const pty = yield* connection
    const close = new Socket.CloseEvent(1000)
    yield* Queue.offerAll(pty.outbox, ["output", close, "after close"])

    expect(yield* Effect.exit(pty.run)).toEqual(Exit.void)
    expect(pty.state.written).toEqual(["output", close])
    expect(pty.state.detached).toBeTrue()
  }),
)

it.live("detaches when the socket fails while the outbox drain is blocked", () =>
  Effect.gen(function* () {
    const pty = yield* connection
    yield* Queue.fail(pty.inbound, fail(new Socket.SocketReadError({ cause: new Error("reset") })))

    expect(Exit.hasDies(yield* Effect.exit(pty.run))).toBeTrue()
    expect(pty.state.detached).toBeTrue()
  }),
)

it.live("detaches when interrupted", () =>
  Effect.gen(function* () {
    const pty = yield* connection
    const fiber = yield* Effect.forkChild(pty.run, { startImmediately: true })
    yield* Fiber.interrupt(fiber)

    expect(pty.state.opened).toBeTrue()
    expect(pty.state.detached).toBeTrue()
  }),
)
