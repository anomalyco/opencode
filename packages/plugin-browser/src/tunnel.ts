export * as BrowserTunnel from "./tunnel.js"

import { createConnection } from "node:net"
import { Deferred, Effect } from "effect"
import type { Socket } from "effect/socket"
import type { Browser } from "./rpc.js"
import { BrowserStream } from "./stream.js"

export type Tunnels = ReturnType<typeof make>

// Each attachment owns its sockets, including pending connections.
export function make() {
  const sockets = new Map<ReturnType<typeof createConnection>, Deferred.Deferred<void, Error>>()
  let disposed = false
  return {
    connect: Effect.fn("BrowserTunnel.connect")(function* (
      target: Browser.TunnelTarget,
      transport: Effect.Effect<Socket.Socket>,
    ) {
      if (disposed) return yield* Effect.fail(new Error("Browser attachment is closed."))
      if (sockets.size >= 64)
        return yield* Effect.fail(new Error("Browser attachment has reached its 64-connection limit."))
      const entry = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const socket = createConnection({ ...target, allowHalfOpen: true })
          const closed = Deferred.makeUnsafe<void, Error>()
          socket.on("error", (error) => {
            Effect.runSync(Deferred.fail(closed, error))
          })
          socket.on("close", () => {
            if (!socket.readableEnded) Effect.runSync(Deferred.fail(closed, new Error("Browser tunnel closed.")))
          })
          sockets.set(socket, closed)
          return { socket, closed }
        }),
        (entry) =>
          Effect.sync(() => {
            sockets.delete(entry.socket)
            entry.socket.destroy()
          }),
      )
      yield* Effect.gen(function* () {
        yield* Effect.callback<void>((resume) => {
          const connected = () => resume(Effect.void)
          entry.socket.once("connect", connected)
          return Effect.sync(() => {
            entry.socket.off("connect", connected)
          })
        }).pipe(Effect.timeout("10 seconds"))
        entry.socket.setNoDelay(true)
        const connection = yield* transport
        const tunnel = yield* BrowserStream.make(connection)
        entry.socket.pipe(tunnel.stream).pipe(entry.socket)
        yield* tunnel.closed
      }).pipe(Effect.raceFirst(Deferred.await(entry.closed)))
    }, Effect.scoped),
    dispose() {
      disposed = true
      sockets.forEach((closed, socket) => {
        Effect.runSync(Deferred.fail(closed, new Error("Browser attachment is closed.")))
        socket.destroy()
      })
      sockets.clear()
    },
  }
}
