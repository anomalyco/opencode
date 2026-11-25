export * as BrowserTunnel from "./tunnel.js"

import type { Socket } from "node:net"
import { Effect, Exit } from "effect"
import { EgressPolicy } from "./egress-policy.js"
import { Browser } from "./rpc.js"
import { BrowserTunnelMachine } from "./tunnel-machine.js"

export type Tunnels = ReturnType<typeof make>

// One instance belongs to one desktop attachment. Socket buffers provide
// backpressure; reads never collect an unbounded stream in application memory.
export function make(policy: EgressPolicy.AttachmentPolicy = EgressPolicy.makePolicy()) {
  let state = BrowserTunnelMachine.initial()
  const sockets = new Map<string, Socket>()
  const connecting = new Map<string, AbortController>()
  const dispatch = (event: BrowserTunnelMachine.Event) => {
    const next = BrowserTunnelMachine.transition(state, event)
    state = next.state
    next.effects.forEach((effect) => {
      connecting.get(effect.id)?.abort()
      connecting.delete(effect.id)
      sockets.get(effect.id)?.destroy()
      sockets.delete(effect.id)
    })
  }

  return {
    open: Effect.fn("BrowserTunnel.open")(function* (target: Browser.TunnelTarget) {
      const rejected = BrowserTunnelMachine.openError(state)
      if (rejected) return yield* Effect.fail(rejected)
      const id = crypto.randomUUID()
      const abort = new AbortController()
      connecting.set(id, abort)
      dispatch({ type: "open.started", id })
      return yield* Effect.gen(function* () {
        // Resolve DNS once, enforce egress policy on every final IP, and connect directly to the checked IP.
        const socket = yield* Effect.tryPromise({
          try: (signal) =>
            EgressPolicy.resolveAndConnect(target, policy, {
              signal: AbortSignal.any([abort.signal, signal]),
              timeoutMs: 10_000,
            }),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
        connecting.delete(id)
        sockets.set(id, socket)
        socket.on("error", (error) => dispatch({ type: "socket.errored", id, error }))
        socket.once("close", () => dispatch({ type: "socket.closed", id }))
        dispatch({ type: "open.connected", id })
        // Disposal or `close(id)` can win the race with the connect.
        if (!BrowserTunnelMachine.isOpen(state, id)) {
          socket.destroy()
          sockets.delete(id)
          return yield* Effect.fail(new Error("Browser attachment is closed."))
        }
        return id
      }).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            connecting.delete(id)
            dispatch({ type: "open.failed", id })
          }),
        ),
      )
    }),
    read: Effect.fn("BrowserTunnel.read")(function* (id: string) {
      const socket = sockets.get(id)
      const rejected = BrowserTunnelMachine.readError(state, id)
      if (rejected || !socket) return yield* Effect.fail(rejected ?? new Error("Browser tunnel is closed or unknown."))
      dispatch({ type: "read.started", id })
      let outcome: BrowserTunnelMachine.ReadOutcome = "interrupted"
      return yield* Effect.callback<Browser.TunnelRead, Error>((resume) => {
        const done = (value: Effect.Effect<Browser.TunnelRead, Error>, result: BrowserTunnelMachine.ReadOutcome) => {
          cleanup()
          outcome = result
          resume(value)
        }
        const pull = () => {
          const error = BrowserTunnelMachine.socketError(state, id)
          if (error) return done(Effect.fail(error), "error")
          const size = Math.min(socket.readableLength, Browser.TUNNEL_CHUNK_BYTES)
          if (size > 0) {
            const data: Buffer = socket.read(size)
            return done(Effect.succeed({ data, eof: false }), "chunk")
          }
          if (socket.readableEnded || socket.destroyed) done(Effect.succeed({ data: new Uint8Array(), eof: true }), "eof")
        }
        const cleanup = () => {
          socket.off("readable", pull)
          socket.off("end", pull)
          socket.off("error", pull)
          socket.off("close", pull)
        }
        socket.on("readable", pull)
        socket.on("end", pull)
        socket.on("error", pull)
        socket.on("close", pull)
        pull()
        return Effect.sync(cleanup)
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => dispatch({ type: "read.settled", id, outcome, socketClosed: socket.destroyed })),
        ),
      )
    }),
    write: Effect.fn("BrowserTunnel.write")(function* (id: string, data: Uint8Array, end: boolean = false) {
      const socket = sockets.get(id)
      const rejected = BrowserTunnelMachine.writeError(state, id)
      if (rejected || !socket || socket.destroyed || socket.writableEnded)
        return yield* Effect.fail(rejected ?? new Error("Browser tunnel is not writable."))
      dispatch({ type: "write.started", id })
      yield* Effect.callback<void, Error>((resume) => {
        const done = (error?: Error | null) => {
          cleanup()
          resume(error ? Effect.fail(error) : Effect.void)
        }
        const failed = (error: Error) => done(error)
        // `destroy()` without an error emits neither "finish" nor "error", so a pending end would never settle.
        const closed = () =>
          done(BrowserTunnelMachine.socketError(state, id) ?? new Error("Browser tunnel closed while writing."))
        const cleanup = () => {
          socket.off("error", failed)
          socket.off("close", closed)
        }
        socket.once("error", failed)
        socket.once("close", closed)
        if (end) socket.end(data, done)
        if (!end) socket.write(data, done)
        return Effect.sync(cleanup)
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            dispatch({
              type: "write.settled",
              id,
              end,
              outcome: Exit.isSuccess(exit) ? "ok" : Exit.hasInterrupts(exit) ? "interrupted" : "error",
              socketClosed: socket.destroyed,
            }),
          ),
        ),
      )
    }),
    close: (id: string) => Effect.sync(() => dispatch({ type: "tunnel.closed", id })),
    dispose() {
      dispatch({ type: "disposed" })
    },
  }
}
