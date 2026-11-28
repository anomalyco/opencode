export * as WorkerdMachineLink from "./workerd-machine-link"

import type { Identity } from "@opencode/core/machine/identity"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { MACHINE_LINK_PATH } from "@opencode/protocol/groups/machine"
import { type Cause, Effect, Option, Queue, Schema, Semaphore, Struct } from "effect"
import { HttpServerRequest } from "effect/http"
import type { CorsOptions } from "./cors"
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
const CLOSING = 2
/** Close codes a peer may report but no endpoint may send: none given, abnormal, and a failed TLS handshake. */
const UNSENDABLE = new Set([1005, 1006, 1015])
/** How often the timer that holds a busy Durable Object awake fires. It does nothing: being pending is the point. */
const KEEPALIVE = 25_000

/** The Durable Object WebSocket tag every hibernatable machine link is accepted with. */
export const TAG = "opencode-machine-link"

/** What every carrier uses of the server half of a workerd `WebSocketPair`. */
export interface Sender {
  readonly readyState: number
  send(message: Uint8Array): void
  close(code: number): void
}

/** The server half once `accept()`ed: workerd hands its messages to its listeners. */
export interface Socket extends Sender {
  binaryType: string
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  addEventListener(type: "close" | "error", listener: () => void): void
}

/**
 * The server half once a Durable Object's `ctx.acceptWebSocket` took it: workerd hands its messages to the Durable
 * Object's `webSocketMessage`, `webSocketClose` and `webSocketError`, and keeps its attachment while the object
 * hibernates.
 */
export interface HibernatableSocket extends Sender {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

export interface PairSocket extends Socket, HibernatableSocket {
  accept(): void
}

/**
 * What hibernation uses of a Durable Object's `ctx` (`DurableObjectState`). With it, a machine link is accepted with
 * `ctx.acceptWebSocket`, so an idle link no longer keeps the object awake, and a wake carries on every link that was
 * past its hello, with no reconnect and nothing on the wire.
 */
export interface State {
  acceptWebSocket(socket: HibernatableSocket, tags?: string[]): void
  getWebSockets(tag?: string): HibernatableSocket[]
}

export interface Options extends CorsOptions {
  /** At most one live `make` per `state`: see `claimed`. */
  readonly state?: State
}

/**
 * The Durable Object's WebSocket methods, which the object forwards to: with `State`, a machine link's messages arrive
 * only here. A socket no link holds is closed with 1008.
 */
export interface Hibernation {
  readonly webSocketMessage: (socket: HibernatableSocket, message: ArrayBuffer | string) => void
  readonly webSocketClose: (socket: HibernatableSocket, code: number, reason: string, wasClean: boolean) => void
  readonly webSocketError: (socket: HibernatableSocket, error: unknown) => void
}

/** A link's state in a socket's attachment, with its version, so an attachment from another version is not resumed. */
const Attachment = Schema.Struct({ v: Schema.Literal(1), ...Link.Resumable.fields })
const encodeAttachment = Schema.encodeSync(Attachment)
const decodeAttachment = Schema.decodeUnknownOption(Attachment)

/**
 * The sockets some live `make` over each `State` holds. A second `make` over the same state, which a Durable Object that
 * boots twice would make, leaves them alone: two copies of one link's ciphers would encrypt under the same key and
 * nonce. Keyed by state, since a wake brings a new `ctx`, and an instance that hibernated never released its own.
 */
const claimed = new WeakMap<State, WeakSet<HibernatableSocket>>()
const claimsOf = (state: State) => {
  const found = claimed.get(state)
  if (found) return found
  const made = new WeakSet<HibernatableSocket>()
  claimed.set(state, made)
  return made
}

export type PairConstructor = new () => { readonly 0: PairSocket; readonly 1: PairSocket }

// workerd's global, and undefined on every other runtime. The server is typed for Bun, whose globals lack it.
declare const WebSocketPair: PairConstructor | undefined

/**
 * `machine.link` on workerd, where a request becomes a WebSocket only by being answered with a 101 response that holds
 * the client half of a `WebSocketPair`. Effect's web handler would rebuild that response without it, so the Durable
 * Object's handler asks this before the routes, without running anything: a GET upgrade to exactly the link's path gets
 * the effect that answers it, and anything else `undefined`, for the routes to answer as they do on Node. Cross-site
 * browser upgrades from origins `options.cors` does not allow also return `undefined` so `RequestSite.middleware`
 * answers them with 403, matching Node. As on
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
export const make = (options: Options = {}, fixed: Link.Fixed = {}) =>
  Effect.gen(function* () {
    const enabled = yield* machinesEnabled
    const services = yield* Effect.context<Machines.Service | Identity.Service>()
    const scope = yield* Effect.scope
    const handshakes = Semaphore.makeUnsafe(MAX_HANDSHAKES)
    const state = options.state
    const claims = state ? claimsOf(state) : new WeakSet<HibernatableSocket>()
    /** The inbox of every hibernatable socket a link holds, for the Durable Object's methods to hand its messages to. */
    const inboxes = new Map<HibernatableSocket, Inbox>()
    // workerd does not hibernate an object with a timer pending, so one is held while any link here has work in flight:
    // that work lives only in this memory, and a machine woken without it would never hear of it again.
    const busy = new Set<HibernatableSocket>()
    const awake: { timer?: ReturnType<typeof setInterval> } = {}
    const hold = (socket: HibernatableSocket, working: boolean) => {
      if (working) busy.add(socket)
      if (!working) busy.delete(socket)
      if (busy.size > 0 && !awake.timer) awake.timer = setInterval(() => {}, KEEPALIVE)
      if (busy.size === 0 && awake.timer) {
        clearInterval(awake.timer)
        awake.timer = undefined
      }
    }
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        busy.clear()
        clearInterval(awake.timer)
        awake.timer = undefined
      }),
    )
    const hibernating = (socket: HibernatableSocket) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const held = yield* inbox(socket)
          claims.add(socket)
          inboxes.set(socket, held)
          return { ...held, keeper: keeper(socket, hold) }
        }),
        (held) =>
          Effect.sync(() => {
            claims.delete(socket)
            inboxes.delete(socket)
            hold(socket, false)
            // Before the close, so a socket workerd still lists while it closes is never resumed.
            socket.serializeAttachment(null)
            held.end(CLOSE)
          }),
      )
    // Each wake starts here, before any of the object's methods can hand over a message: every socket a link held is
    // taken back at once, and its messages wait in its inbox until the link carries on or is refused.
    for (const socket of state?.getWebSockets(TAG) ?? []) {
      if (claims.has(socket)) continue
      // Closing already: marking its machine online would only be undone.
      if (socket.readyState !== OPEN) {
        socket.serializeAttachment(null)
        continue
      }
      yield* Effect.gen(function* () {
        const held = yield* hibernating(socket)
        const saved = decodeAttachment(socket.deserializeAttachment())
        if (Option.isNone(saved) || !(yield* enabled)) return
        const link = yield* Link.resume(held.carrier, saved.value, fixed, { persist: held.keeper.persist })
        const machines = yield* Machines.Service
        yield* machines.connect(link.machine, { ...link.connection, busy: held.keeper.busy })
      }).pipe(Effect.ignore, Effect.scoped, Effect.provide(services), Effect.forkIn(scope, { startImmediately: true }))
    }
    const accept = (pair: { readonly 1: PairSocket }, release: Effect.Effect<unknown>) => {
      if (!state) {
        pair[1].accept()
        return serve(pair[1], release, fixed)
      }
      state.acceptWebSocket(pair[1], [TAG])
      return Effect.gen(function* () {
        const held = yield* hibernating(pair[1])
        const link = yield* Link.serve(held.carrier, fixed, { persist: held.keeper.persist }).pipe(
          Effect.ensuring(release),
        )
        const machines = yield* Machines.Service
        yield* machines.connect(link.machine, { ...link.connection, busy: held.keeper.busy })
      }).pipe(Effect.ignore, Effect.scoped)
    }
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
            // Not a `ResponseInit` anywhere but workerd, which alone allows a 101.
            const init = { status: 101, webSocket: pair[0] }
            const response = new Response(null, init)
            // Started at once, so it listens before the 101 is returned and hears the worker's first message, sent as soon
            // as the worker reads it. `forkIn` leaves the child interruptible when `scope` closes.
            yield* accept(pair, release).pipe(
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
    const holding = (socket: HibernatableSocket) => {
      const found = inboxes.get(socket)
      if (!found && socket.readyState === OPEN) socket.close(CLOSE)
      return found
    }
    const hibernation: Hibernation = {
      webSocketMessage: (socket, message) => holding(socket)?.message(message),
      webSocketClose: (socket, code) => {
        inboxes.get(socket)?.end(CLOSE)
        // workerd leaves a hibernatable socket's closing handshake to the object: without an answer the peer sees 1006.
        if (socket.readyState === CLOSING) socket.close(UNSENDABLE.has(code) ? 1000 : code)
      },
      webSocketError: (socket) => holding(socket)?.end(CLOSE),
    }
    return Object.assign(
      (request: Request, pair?: PairConstructor) => {
        const resolved = pair ?? (typeof WebSocketPair === "undefined" ? undefined : WebSocketPair)
        return !resolved || !isUpgrade(request, options) ? undefined : upgrade(resolved)
      },
      hibernation,
      {
        /** Whether a link with work in flight is holding the object awake. */
        keepingAwake: () => awake.timer !== undefined,
      },
    )
  })

/**
 * Keeps a socket's attachment to what a wake may resume: the link's latest state while its machine is idle, and nothing
 * while work is in flight or a message is half across, so a wake then closes the socket with 1008 and the worker
 * reconnects with a hello that lists its processes, which the home reconciles.
 */
const keeper = (socket: HibernatableSocket, hold: (socket: HibernatableSocket, busy: boolean) => void) => {
  const at: { state?: Link.Resumable; busy: boolean } = { busy: false }
  const write = () => attach(socket, at.busy ? undefined : at.state)
  return {
    persist: (state: Link.Resumable | undefined) => {
      at.state = state
      write()
    },
    busy: (busy: boolean) => {
      at.busy = busy
      hold(socket, busy)
      write()
    },
  }
}

/**
 * Saves a link's state in its socket's attachment, or clears it, in the same synchronous step as each change to the
 * link's ciphers: workerd hibernates only between events, so the attachment it keeps never holds a nonce already used. A
 * Durable Object that is evicted rather than hibernated loses its sockets with it, so nothing older is ever resumed.
 * The hello is kept without its processes and peer links: a link is saved only while its machine has none, and an
 * attachment holds at most 2,048 bytes. Should it still not fit, the attachment is cleared and a wake closes the socket.
 */
const attach = (socket: HibernatableSocket, state: Link.Resumable | undefined) => {
  if (!state) return socket.serializeAttachment(null)
  const hello = { ...Struct.omit(state.hello, ["processes", "links"]), processes: [] }
  const value = encodeAttachment({ v: 1, ...state, hello })
  try {
    socket.serializeAttachment(value)
  } catch {
    socket.serializeAttachment(null)
  }
}

/**
 * Serves one accepted socket in a scope of its own: the handshake, then `release` however it ends, then the machine it
 * proved until the link ends. Every end, a refused handshake and a removed machine among them, closes the scope and with
 * it the socket, the same quiet way.
 */
export const serve = (socket: Socket, release: Effect.Effect<unknown>, fixed: Link.Fixed = {}) =>
  Effect.gen(function* () {
    const link = yield* Link.serve(yield* carrier(socket), fixed).pipe(Effect.ensuring(release))
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
  const held = yield* inbox(socket)
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      // workerd hands binary messages over as Blobs from its 2026 compatibility dates unless told otherwise.
      socket.binaryType = "arraybuffer"
      socket.addEventListener("message", (event) => held.message(event.data))
      socket.addEventListener("close", () => held.end(CLOSE))
      socket.addEventListener("error", () => held.end(CLOSE))
    }),
    () => Effect.sync(() => held.end(CLOSE)),
  )
  return held.carrier
})

type Inbox = Effect.Success<ReturnType<typeof inbox>>

/**
 * The carrier of one socket, fed by `message` and ended by `end`, however its messages arrive: from its listeners, or
 * from the Durable Object's methods once it hibernates. See `carrier` for what it refuses.
 */
const inbox = Effect.fnUntraced(function* (socket: Sender) {
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
  const carrier = {
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
  return { message, end, carrier }
})

/**
 * A same-site GET with `Upgrade: websocket` to the path the router matches. `Upgrade` alone, as Cloudflare's examples
 * check: `Connection` is hop-by-hop, and a Worker forwarding the request to its Durable Object need not keep it.
 * Cross-site browser upgrades from origins `options.cors` does not allow return `false` so the router's `RequestSite`
 * middleware rejects them with 403.
 */
export const isUpgrade = (request: Request, options?: CorsOptions) =>
  request.method === "GET" &&
  request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
  URL.parse(request.url, "http://localhost")?.pathname === MACHINE_LINK_PATH &&
  !RequestSite.rejected(HttpServerRequest.fromWeb(request), options)
