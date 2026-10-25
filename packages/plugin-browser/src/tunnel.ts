export * as BrowserTunnel from "./tunnel.js"

import type { Socket } from "node:net"
import { Effect } from "effect"
import { Browser } from "./rpc.js"

export type Tunnels = ReturnType<typeof make>

// One instance belongs to one desktop attachment. Socket buffers provide
// backpressure; reads never collect an unbounded stream in application memory.
export function make() {
  const sockets = new Map<string, { socket: Socket; reading: boolean; error?: Error }>()
  let disposed = false
  const close = (id: string) =>
    Effect.sync(() => {
      sockets.get(id)?.socket.destroy()
      sockets.delete(id)
    })

  return {
    open: Effect.fn("BrowserTunnel.open")(function* (target: Browser.TunnelTarget) {
      const { createConnection } = yield* Effect.promise(() => import("node:net"))
      if (disposed) return yield* Effect.fail(new Error("Browser attachment is closed."))
      if (sockets.size >= 64)
        return yield* Effect.fail(new Error("Browser attachment has reached its 64-connection limit."))
      const socket = yield* Effect.try({
        try: () => createConnection({ ...target, allowHalfOpen: true }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
      const id = crypto.randomUUID()
      const entry = { socket, reading: false, error: undefined as Error | undefined }
      socket.on("error", (error) => {
        entry.error = error
      })
      sockets.set(id, entry)
      yield* Effect.callback<void, Error>((resume) => {
        const connected = () => {
          cleanup()
          socket.setNoDelay(true)
          resume(Effect.void)
        }
        const failed = (error: Error) => {
          cleanup()
          resume(Effect.fail(error))
        }
        const closed = () => failed(entry.error ?? new Error("Browser tunnel closed while connecting."))
        const cleanup = () => {
          socket.off("connect", connected)
          socket.off("error", failed)
          socket.off("close", closed)
        }
        socket.once("connect", connected)
        socket.once("error", failed)
        socket.once("close", closed)
        if (socket.destroyed) closed()
        if (!socket.destroyed && !socket.connecting) connected()
        return Effect.sync(cleanup)
      }).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.fail(new Error("Browser tunnel target connection timed out.")),
        }),
        Effect.onError(() => close(id)),
      )
      return id
    }),
    read: Effect.fn("BrowserTunnel.read")(function* (id: string) {
      const entry = sockets.get(id)
      if (!entry) return yield* Effect.fail(new Error("Browser tunnel is closed or unknown."))
      if (entry.reading) return yield* Effect.fail(new Error("Only one read may be pending per browser tunnel."))
      entry.reading = true
      return yield* Effect.callback<Browser.TunnelRead, Error>((resume) => {
        const done = (value: Effect.Effect<Browser.TunnelRead, Error>) => {
          cleanup()
          resume(value)
        }
        const pull = () => {
          if (entry.error) return done(Effect.fail(entry.error))
          const size = Math.min(entry.socket.readableLength, Browser.TUNNEL_CHUNK_BYTES)
          if (size > 0) {
            const data: Buffer = entry.socket.read(size)
            return done(Effect.succeed({ data, eof: false }))
          }
          if (entry.socket.readableEnded || entry.socket.destroyed)
            done(Effect.succeed({ data: new Uint8Array(), eof: true }))
        }
        const cleanup = () => {
          entry.reading = false
          entry.socket.off("readable", pull)
          entry.socket.off("end", pull)
          entry.socket.off("error", pull)
          entry.socket.off("close", pull)
        }
        entry.socket.on("readable", pull)
        entry.socket.on("end", pull)
        entry.socket.on("error", pull)
        entry.socket.on("close", pull)
        pull()
        return Effect.sync(cleanup)
      })
    }),
    write: Effect.fn("BrowserTunnel.write")(function* (id: string, data: Uint8Array, end: boolean = false) {
      const entry = sockets.get(id)
      if (!entry || entry.socket.destroyed || entry.socket.writableEnded)
        return yield* Effect.fail(new Error("Browser tunnel is not writable."))
      yield* Effect.callback<void, Error>((resume) => {
        const done = (error?: Error | null) => {
          entry.socket.off("error", failed)
          resume(error ? Effect.fail(error) : Effect.void)
        }
        const failed = (error: Error) => done(error)
        entry.socket.once("error", failed)
        if (end) entry.socket.end(data, () => done())
        if (!end) entry.socket.write(data, done)
        return Effect.sync(() => {
          entry.socket.off("error", failed)
        })
      }).pipe(Effect.onInterrupt(() => close(id)))
    }),
    close,
    dispose() {
      disposed = true
      sockets.forEach((entry) => entry.socket.destroy())
      sockets.clear()
    },
  }
}
