export * as WorkerdMachineLink from "./workerd-machine-link"

import type { Identity } from "@opencode/core/machine/identity"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { MACHINE_LINK_PATH } from "@opencode/protocol/groups/machine"
import { type Cause, Effect, Queue, Semaphore } from "effect"
import { HttpServerRequest } from "effect/http"
import { CLOSE, MAX_FRAME, MAX_HANDSHAKES, MIN_FRAME, machinesEnabled } from "./handlers/machine"
import { RequestSite } from "./request-site"

/**
 * The most that may wait unread. workerd cannot stop reading a socket as `ws` can, so a peer that sends faster than the
 * link reads would grow the isolate without end; past this the carrier ends. The bound `WorkerClient.fromWebSocket`
 * keeps, well under an isolate's 128 MB.
 */
const MAX_WAITING = 8 * 1024 * 1024
/** Message too big: the close `ws` gives a message over `MAX_FRAME` on Node. */
const TOO_BIG = 1009
const OPEN = 1

/** What the carrier uses of the server half of a workerd `WebSocketPair`, once accepted. */
export interface Socket {
  readonly readyState: number
  binaryType: string
  send(message: Uint8Array): void
  close(code: number): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  addEventListener(type: "close" | "error", listener: () => void): void
}

export interface PairSocket extends Socket {
  accept(): void
}

export type PairConstructor = new () => { readonly 0: PairSocket; readonly 1: PairSocket }

// workerd's global, and undefined on every other runtime. The server is typed for Bun, whose globals lack it.
declare const WebSocketPair: PairConstructor | undefined

/**
 * `machine.link` on workerd, where a request becomes a WebSocket only by being answered with a 101 response that holds
 * the client half of a `WebSocketPair`. Effect's web handler would rebuild that response without it, so the Durable
 * Object's handler asks this before the routes, without running anything: a GET upgrade to exactly the link's path gets
 * the effect that answers it, and anything else `undefined`, for the routes to answer as they do on Node. Cross-site
 * browser upgrades also return `undefined` so `RequestSite.middleware` answers them with 403, matching Node. As on
 * Node, the upgrade takes no password, since the socket carries nothing until the link's handshake has proved a paired
 * key or a valid join secret, and with machines off it gets the 404 of an unknown route.
 *
 * A place is taken before the upgrade and held until the handshake ends; with none free (or once the server's scope has
 * closed) the request is answered 503, as on Node. The request is over once its 101 is returned, so each connection is
 * served on a fiber of the caller's scope, and closing that scope closes every link.
 *
 * Unlike `ws`, workerd's socket can neither ping nor say what waits unsent, so a link here has no idle limit and no limit
 * on what waits behind a slow peer: a peer that is gone is noticed when workerd closes its socket.
 */
export const make = Effect.gen(function* () {
  const enabled = yield* machinesEnabled
  const services = yield* Effect.context<Machines.Service | Identity.Service>()
  const scope = yield* Effect.scope
  const handshakes = Semaphore.makeUnsafe(MAX_HANDSHAKES)
  const upgrade = Effect.fn("WorkerdMachineLink.upgrade")(function* (Pair: PairConstructor) {
    if (!(yield* enabled)) return new Response(null, { status: 404 })
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        if (scope.state._tag === "Closed" || !(yield* handshakes.takeIfAvailable(1)))
          return new Response(null, { status: 503 })
        const released = { value: false }
        const release = Effect.suspend(() => {
          if (released.value) return Effect.void
          released.value = true
          return handshakes.release(1)
        })
        const pair = new Pair()
        return yield* Effect.gen(function* () {
          pair[1].accept()
          // Not a `ResponseInit` anywhere but workerd, which alone allows a 101.
          const init = { status: 101, webSocket: pair[0] }
          const response = new Response(null, init)
          // Started at once, so it listens before the 101 is returned and hears the worker's first message, sent as soon
          // as the worker reads it. `forkIn` leaves the child interruptible when `scope` closes.
          yield* serve(pair[1], release).pipe(
            Effect.provide(services),
            Effect.forkIn(scope, { startImmediately: true }),
          )
          return response
        }).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              if (pair[1].readyState === OPEN) pair[1].close(CLOSE)
            }).pipe(Effect.andThen(release)),
          ),
        )
      }),
    )
  })
  return (request: Request, pair?: PairConstructor) => {
    const resolved = pair ?? (typeof WebSocketPair === "undefined" ? undefined : WebSocketPair)
    return !resolved || !isUpgrade(request) ? undefined : upgrade(resolved)
  }
})

/**
 * Serves one accepted socket in a scope of its own: the handshake, then `release` however it ends, then the machine it
 * proved until the link ends. Every end, a refused handshake and a removed machine among them, closes the scope and with
 * it the socket, the same quiet way.
 */
export const serve = (socket: Socket, release: Effect.Effect<unknown>) =>
  Effect.gen(function* () {
    const link = yield* Link.serve(yield* carrier(socket)).pipe(Effect.ensuring(release))
    const machines = yield* Machines.Service
    yield* machines.connect(link.machine, link.connection)
  }).pipe(Effect.ignore, Effect.scoped)

/**
 * An accepted workerd socket as the link's carrier, for the scope: closing the scope closes the socket with `CLOSE`.
 * Binary messages are handed over in order. The carrier ends and closes the socket when the peer closes it or it fails,
 * and on what no link sends: a text message, one too short to be a frame or, with 1009 as `ws` gives, too long to be
 * one, and more than `MAX_WAITING` unread. Messages that came before the end are still handed over, as they are on Node.
 */
export const carrier = Effect.fnUntraced(function* (socket: Socket) {
  const inbound = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const held = { bytes: 0 }
  const end = (code: number) => {
    // The socket first: ending the queue resumes the reader at once, and the link it fails closes the socket too. A
    // peer's close workerd answers itself, which leaves the socket closed.
    if (socket.readyState === OPEN) socket.close(code)
    Queue.endUnsafe(inbound)
  }
  const message = (data: unknown) => {
    // Text, and a Blob on a socket whose binary type was not set.
    if (!(data instanceof ArrayBuffer)) return end(CLOSE)
    if (data.byteLength > MAX_FRAME) return end(TOO_BIG)
    if (data.byteLength < MIN_FRAME || held.bytes + data.byteLength > MAX_WAITING) return end(CLOSE)
    if (Queue.offerUnsafe(inbound, new Uint8Array(data))) held.bytes += data.byteLength
  }
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      // workerd hands binary messages over as Blobs from its 2026 compatibility dates unless told otherwise.
      socket.binaryType = "arraybuffer"
      socket.addEventListener("message", (event) => message(event.data))
      socket.addEventListener("close", () => end(CLOSE))
      socket.addEventListener("error", () => end(CLOSE))
    }),
    () => Effect.sync(() => end(CLOSE)),
  )
  return {
    describe: () => ({ kind: "websocket" }),
    send: (bytes) =>
      // `send` can throw if the peer dropped the connection before workerd delivered the queued close event.
      Effect.try(() => {
        if (socket.readyState === OPEN) socket.send(bytes)
      }).pipe(Effect.catch(() => Effect.sync(() => end(CLOSE)))),
    receive: Queue.take(inbound).pipe(
      Effect.map((bytes) => {
        held.bytes -= bytes.byteLength
        return bytes
      }),
      Effect.mapError(() => new Link.Closed()),
    ),
  } satisfies Link.Carrier
})

/**
 * A same-site GET with `Upgrade: websocket` to the path the router matches. `Upgrade` alone, as Cloudflare's examples
 * check: `Connection` is hop-by-hop, and a Worker forwarding the request to its Durable Object need not keep it.
 * Cross-site browser upgrades return `false` so the router's `RequestSite` middleware rejects them with 403.
 */
export const isUpgrade = (request: Request) =>
  request.method === "GET" &&
  request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
  URL.parse(request.url, "http://localhost")?.pathname === MACHINE_LINK_PATH &&
  !RequestSite.rejected(HttpServerRequest.fromWeb(request))
