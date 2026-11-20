import { NodeHttpServerRequest } from "@effect/platform-node"
import { type WebSocket, WebSocketServer } from "@effect/platform-node-shared/NodeWS"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Frames } from "@opencode/core/machine/frames"
import { Identity } from "@opencode/core/machine/identity"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { AbsolutePath } from "@opencode/core/schema"
import { isWebSocketUpgrade } from "@opencode/protocol/groups/machine"
import { Global } from "@opencode/util/global"
import { Context, Effect, Latch, Option, Scope, Semaphore } from "effect"
import { HttpMiddleware, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { Socket } from "effect/socket"
import { IncomingMessage } from "node:http"

/** Handshakes in progress across the server: what strangers can hold open at once, each for at most ten seconds. */
const MAX_HANDSHAKES = 32
/** Noise's largest message, so nothing longer is ever a frame. */
const MAX_FRAME = 65_535
/** Noise's authentication tag, which every frame ends with, so nothing shorter is ever a frame. */
const MIN_FRAME = 16
/**
 * The most that may wait unread. The link holds at most the one message it is reassembling, so a message's worth
 * waiting behind that means the socket is not holding the peer back, and the carrier ends rather than keep it.
 */
const MAX_WAITING = Frames.MAX_MESSAGE
/** How long a send waits on a peer that takes none of what the socket already holds. */
const STALL = "60 seconds"
/** How often a served link is pinged. A peer not heard from since the last ping is gone, so within two of these. */
const PING = "30 seconds"
/** How long a machine that got past the handshake has to answer the home's close before its connection is dropped. */
const CLOSING = "5 seconds"
/** How long a stopping server gives every link at once to answer the close, so no peer can keep it from stopping. */
const STOPPING = "1 second"
/**
 * Policy violation, the code RFC 6455 gives for hiding the reason. Every close the home makes carries it and no
 * reason: a refused handshake, a bad frame, a removed machine and a shutdown look the same.
 */
const CLOSE = 1008

/**
 * Only for tests, as `Link.Fixed` is: called with the endpoint's `ws` server when it is made, so a test can count its
 * clients and watch a socket from the home's side. Production never sets it.
 */
export const Watch = Context.Reference<(sockets: WebSocketServer) => void>("@opencode/MachineLink/Watch", {
  defaultValue: () => () => {},
})

/** Whether the `machines` flag is on in the server's base configuration, where the video routes read theirs. */
export const machinesEnabled = Effect.gen(function* () {
  const global = yield* Global.Service
  const locations = yield* LocationServiceMap.Service
  return Flag.enabled("machines").pipe(
    Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
    Effect.orElseSucceed(() => false),
  )
})

/** Sends the close and drops the connection at once, without the time a machine has to answer it. */
const drop = (socket: WebSocket) => {
  socket.close(CLOSE)
  socket.terminate()
}

/**
 * Upgrades a request the HTTP server took off its parser, on the endpoint's own `ws` server, and gives its `ws` socket
 * for the scope. Closing the scope sends the close and waits until the connection is gone, dropping it if the peer has
 * not answered within `CLOSING`: the HTTP response the route returns afterwards must find nothing to be written to.
 */
export const upgrade = (sockets: WebSocketServer, request: IncomingMessage) =>
  Effect.acquireRelease(
    Effect.callback<WebSocket, Link.Closed>((resume) => {
      // `ws` answers a handshake it refuses itself and never calls back: the connection closing is all there is.
      const refused = () => resume(Effect.fail(new Link.Closed()))
      if (request.socket.destroyed) return refused()
      request.socket.once("close", refused)
      // No head: the bytes that arrived with the request are not kept for a route, and a WebSocket client sends none
      // until it has read the 101. One that did would lose them, and the link's handshake would run out of time.
      sockets.handleUpgrade(request, request.socket, Buffer.alloc(0), (socket) => {
        request.socket.off("close", refused)
        // The reader stops reading on the bytes that wait, and frames of none would wait without end. This hears a
        // message before the reader does and drops the connection on one too short to be a frame, so the reader is
        // handed that one and nothing after it.
        socket.on("message", (data) => {
          if ([data].flat().reduce((bytes, part) => bytes + part.byteLength, 0) < MIN_FRAME) drop(socket)
        })
        resume(Effect.succeed(socket))
      })
    }),
    (socket) =>
      Effect.gen(function* () {
        const gone = Effect.callback<void>((resume) => {
          if (socket.readyState === socket.CLOSED) return resume(Effect.void)
          socket.once("close", () => resume(Effect.void))
        })
        socket.close(CLOSE)
        if (Option.isNone(yield* Effect.timeoutOption(gone, CLOSING))) socket.terminate()
      }),
  )

/** What the carrier and the keepalive use of a `ws` socket. */
export interface Transport {
  readonly bufferedAmount: number
  /** Whether reading is stopped because enough already waits unread. Nothing the peer sends is seen meanwhile. */
  readonly isPaused: boolean
  /** Calls back once the socket has taken the message, or cannot. */
  send(message: Uint8Array, taken: () => void): void
  ping(): void
  on(event: "pong" | "ping" | "message", listener: () => void): unknown
  off(event: "pong" | "ping" | "message", listener: () => void): unknown
  /** Drops the connection at once, sending nothing more. */
  terminate(): void
}

/**
 * A `ws` socket as the link's carrier, read through Effect's reader. A text message ends it like a closed socket, before
 * anything is decrypted: the caller closes the socket. Inbound memory is bounded by the socket: `ws` refuses a message
 * over `MAX_FRAME` before buffering it, `upgrade` drops the connection on one under `MIN_FRAME`, and the reader stops
 * reading once 64 KiB waits, so what is held is that and what one read of the connection brings, and a read that still
 * brings more than `MAX_WAITING` ends the carrier. `send` returns once the socket has taken the message, so the link's
 * one writer never has more than a frame waiting behind a slow peer, and it drops a socket that takes nothing at all
 * for `STALL`.
 */
export const carrier = (reader: Socket.Reader, transport: Transport): Link.Carrier => {
  const waiting: Array<Uint8Array | string> = []
  return {
    send: (message) =>
      Effect.gen(function* () {
        const taken = Latch.makeUnsafe()
        transport.send(message, () => taken.openUnsafe())
        while (true) {
          const held = transport.bufferedAmount
          if (Option.isSome(yield* Effect.timeoutOption(taken.await, STALL))) return
          // A close frame would wait behind what the peer is not reading. The reader sees this as the socket closing.
          if (transport.bufferedAmount >= held) return transport.terminate()
        }
      }),
    receive: Effect.gen(function* () {
      if (waiting.length === 0) {
        const read = yield* reader.pull
        if (read.reduce((bytes, message) => bytes + message.length, 0) > MAX_WAITING) return yield* new Link.Closed()
        waiting.push(...read)
      }
      const message = waiting.shift()
      if (message === undefined || typeof message === "string") return yield* new Link.Closed()
      return message
    }).pipe(Effect.mapError(() => new Link.Closed())),
  }
}

/**
 * The idle limit of a served link: pings the peer every `PING` and drops the connection once a whole interval passes
 * with nothing from it. Its answer counts, and so does anything else it sent. While reading is paused none of that can
 * be seen, so an interval is held against the peer only if reading was paused at neither end of it. That covers a
 * pause in between as well: reading pauses on a message, and a message is the peer heard.
 */
export const keepalive = (transport: Transport) =>
  Effect.gen(function* () {
    const interval = { heard: true, paused: false }
    const heard = () => {
      interval.heard = true
    }
    const events = ["pong", "ping", "message"] as const
    events.forEach((event) => transport.on(event, heard))
    yield* Effect.addFinalizer(() => Effect.sync(() => events.forEach((event) => transport.off(event, heard))))
    while (interval.heard || interval.paused || transport.isPaused) {
      interval.heard = false
      interval.paused = transport.isPaused
      transport.ping()
      yield* Effect.sleep(PING)
    }
    transport.terminate()
  }).pipe(Effect.scoped)

/**
 * `machine.link` in the `server.experimental` group: the WebSocket where a machine's link lands. Anyone who can reach
 * the server can open it, and only the link's handshake gets past it. One scope per connection holds the socket and the
 * link's fibers, and closing it is the only way a connection ends, whatever ended it. The first request shaped like a
 * link upgrade reads the flag from the server's base configuration, which loads that configuration once even when the
 * flag is off; only a GET WebSocket upgrade to exactly this path does.
 */
export const makeMachineLink = Effect.gen(function* () {
  const enabled = yield* machinesEnabled
  const services = yield* Effect.context<Machines.Service | Identity.Service>()
  const handshakes = Semaphore.makeUnsafe(MAX_HANDSHAKES)
  const scope = yield* Effect.scope
  const watch = yield* Watch
  // The endpoint's own `ws` server. The socket Effect makes of an upgraded request cannot say what waits unsent, ping
  // or drop the connection, and the server behind it takes messages of 100 MiB. This one refuses a message over
  // `MAX_FRAME` before it is buffered, which `ws` closes with 1009.
  //
  // It is made for the first request that gets past every check below, as Effect's HTTP server makes its own, and not
  // with the routes: those are also built where there is no Node, whose `ws` has no server, and no request there
  // gets that far.
  //
  // The routes' scope closes as the server begins to stop, and stopping waits on no peer: every link is sent the close,
  // `ws` refuses any upgrade from here on, and what is still connected after `STOPPING` is dropped. Left open, one
  // link would hold the server for the twenty seconds it gives open connections.
  const server = yield* Effect.cached(
    Effect.acquireRelease(
      Effect.sync(() => {
        const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
        watch(sockets)
        return sockets
      }),
      (sockets) =>
        Effect.gen(function* () {
          sockets.clients.forEach((socket) => socket.close(CLOSE))
          const empty = Effect.callback<void>((resume) => sockets.close(() => resume(Effect.void)))
          if (Option.isNone(yield* Effect.timeoutOption(empty, STOPPING)))
            sockets.clients.forEach((socket) => socket.terminate())
        }),
    ).pipe(Scope.provide(scope)),
  )
  return Effect.fn("MachineLink.serve")(function* (request: HttpServerRequest.HttpServerRequest) {
    const incoming = NodeHttpServerRequest.toIncomingMessage(request)
    // Without the flag, or for anything but the upgrade, this is the answer an unknown route gets. HTTP/2 has no
    // upgrade, and `request.upgrade` fails unless the server took the request off its HTTP parser to be upgraded; the
    // socket Effect would make of it is not used.
    if (
      !(incoming instanceof IncomingMessage) ||
      !isWebSocketUpgrade(request) ||
      Option.isNone(yield* Effect.option(request.upgrade)) ||
      !(yield* enabled)
    )
      return HttpServerResponse.empty({ status: 404 })
    return yield* Effect.gen(function* () {
      // A place is taken before the upgrade and held until the handshake has ended, so no more strangers than there
      // are places are ever WebSockets. With none free the request is answered as HTTP, as `ws` answers an upgrade
      // once the server is stopping.
      const sockets = yield* server
      const admitted = yield* handshakes.withPermitsIfAvailable(1)(
        Effect.gen(function* () {
          const transport = yield* upgrade(sockets, incoming)
          // The request ended as a WebSocket: the HTTP server would otherwise log every link the home closes as aborted.
          yield* HttpMiddleware.withLoggerDisabled(Effect.void)
          const socket = yield* Socket.fromWebSocket(Effect.succeed(transport))
          const link = yield* Link.serve(carrier(yield* socket.reader, transport)).pipe(
            // A stranger gives up its place with its connection: the time to answer a close is for machines.
            Effect.onError(() => Effect.sync(() => drop(transport))),
          )
          return { transport, link }
        }),
      )
      if (Option.isNone(admitted)) return HttpServerResponse.empty({ status: 503 })
      yield* Effect.forkScoped(keepalive(admitted.value.transport))
      const machines = yield* Machines.Service
      yield* machines.connect(admitted.value.link.machine, admitted.value.link.connection)
      return HttpServerResponse.empty()
    }).pipe(
      Effect.scoped,
      // A WebSocket handshake `ws` refused, a refused link and a machine removed since it: one quiet close.
      Effect.orElseSucceed(() => HttpServerResponse.empty()),
      Effect.provide(services),
    )
  })
})
