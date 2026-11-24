import { Identity } from "@opencode/core/machine/identity"
import { Link } from "@opencode/core/machine/link"
import { Machines } from "@opencode/core/machine/machines"
import { LocationServiceMap } from "@opencode/core/location-services"
import { isMachineLinkUpgrade } from "@opencode/protocol/groups/machine"
import { Global } from "@opencode/util/global"
import { Cause, Clock, Context, Duration, Effect, Queue, Result, Scope } from "effect"
import { CLOSE, machinesEnabled, MAX_FRAME, MAX_HANDSHAKES, MIN_FRAME, STALL } from "./machine"

const OPEN = 1
const CLOSING = 2
const CLOSED = 3
const TOO_BIG = 1009
const BUFFER_POLL = "50 millis"

/**
 * Memory bounds sized for a Cloudflare Durable Object (~128 MiB isolate budget). workerd delivers
 * inbound WebSocket frames as events without TCP read-pause, and queued outbound bytes count toward
 * isolate memory (workerd >= 1.20261111.1). Unauthenticated handshakes are capped to 4 KiB each
 * (32 * 4 KiB = 128 KiB total) until Noise + Hello completes, then raised to 4 MiB for paired links.
 */
export const WORKERD_MAX_HANDSHAKE_WAITING = 4 * 1024
export const WORKERD_MAX_WAITING = 4 * 1024 * 1024
export const WORKERD_MAX_BUFFERED = 1024 * 1024

/** The subset of a Cloudflare Workers server WebSocket used by the machine link carrier. */
export interface WorkerdWebSocket {
  readonly readyState: number
  readonly bufferedAmount?: number
  accept(): void
  send(message: Uint8Array | ArrayBuffer | string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  addEventListener(type: "close" | "error", listener: () => void): void
  removeEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  removeEventListener(type: "close" | "error", listener: () => void): void
}

/** Pair constructor and 101 response builder; overridden in tests without mutating globalThis. */
export interface WorkerdWebSocketPairFactory {
  readonly create: () => readonly [client: WorkerdWebSocket, server: WorkerdWebSocket] | undefined
  readonly respond: (client: WorkerdWebSocket) => Response
}

type GlobalWebSocketPair = {
  new (): { readonly 0: WorkerdWebSocket; readonly 1: WorkerdWebSocket }
}

type WorkerdResponseInit = ResponseInit & { readonly webSocket: WorkerdWebSocket }

const defaultPairFactory: WorkerdWebSocketPairFactory = {
  create: () => {
    const Pair = (globalThis as { readonly WebSocketPair?: GlobalWebSocketPair }).WebSocketPair
    if (!Pair) return undefined
    const pair = new Pair()
    return [pair[0], pair[1]] as const
  },
  respond: (webSocket) => new Response(null, { status: 101, webSocket } as WorkerdResponseInit),
}

export const WorkerdWebSocketPair = Context.Reference<WorkerdWebSocketPairFactory>(
  "@opencode/MachineLink/WorkerdWebSocketPair",
  { defaultValue: () => defaultPairFactory },
)

const rawPath = (url: string) => {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/.exec(url)
  return match ? url.slice(match[0].length) : url
}

const isWorkerdMachineLinkUpgrade = (request: Request) =>
  isMachineLinkUpgrade({
    method: request.method,
    url: rawPath(request.url),
    headers: {
      upgrade: request.headers.get("upgrade") ?? undefined,
      connection: request.headers.get("connection") ?? undefined,
    },
  })

const binaryPayload = (data: unknown) => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

const closeQuietly = (socket: WorkerdWebSocket, code: number) => {
  if (socket.readyState === CLOSED) return
  Result.try(() => socket.close(code))
}

interface WorkerdCarrierHandle {
  readonly carrier: Link.Carrier
  /** Raises the inbound queue cap once the Noise + Hello handshake has authenticated the peer. */
  readonly promote: () => void
  readonly dispose: (code: number) => void
}

/**
 * Adapts a workerd `WebSocketPair` server socket into a bounded `Link.Carrier`.
 *
 * Listeners are attached before `server.accept()` is called so no initial Noise message is lost.
 * Text frames, frames outside `[MIN_FRAME, MAX_FRAME]`, and unread floods exceeding the active
 * inbound cap (`WORKERD_MAX_HANDSHAKE_WAITING` during handshake, `WORKERD_MAX_WAITING` after
 * `promote()`) close the socket immediately and fail `receive` with `Link.Closed`.
 *
 * Outbound backpressure polls `socket.bufferedAmount` (requires workerd >= 1.20261117.1; older
 * runtimes omit `bufferedAmount` and send without waiting) once it exceeds `WORKERD_MAX_BUFFERED`,
 * dropping sockets that fail to drain for `STALL`.
 *
 * Note: Cloudflare Workers server WebSockets cannot send RFC 6455 Ping frames, so unlike Node's
 * `keepalive`, silent half-open peers rely on the worker's own keepalive and reconnect until a
 * link-layer heartbeat is added.
 */
export const createWorkerdCarrier = Effect.fnUntraced(function* (
  socket: WorkerdWebSocket,
): Effect.fn.Return<WorkerdCarrierHandle> {
  const inbox = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const stallMillis = Duration.toMillis(Duration.fromInputUnsafe(STALL))
  let maxWaiting = WORKERD_MAX_HANDSHAKE_WAITING
  let queuedBytes = 0
  let ended = false
  let aborted = false
  let closed = false

  const detach = () => {
    socket.removeEventListener("message", onMessage)
    socket.removeEventListener("close", onClose)
    socket.removeEventListener("error", onError)
  }

  const dropInbox = () => {
    while (Queue.sizeUnsafe(inbox) > 0) Queue.takeUnsafe(inbox)
    queuedBytes = 0
  }

  const abort = (code: number) => {
    if (aborted) return
    aborted = true
    ended = true
    detach()
    dropInbox()
    Queue.endUnsafe(inbox)
    if (!closed) {
      closed = true
      closeQuietly(socket, code)
    }
  }

  const onClose = () => {
    if (ended) return
    ended = true
    closed = true
    detach()
    // On compatibility dates without `web_socket_auto_reply_to_close`, reply to a peer-initiated close.
    if (socket.readyState === CLOSING) closeQuietly(socket, CLOSE)
    Queue.endUnsafe(inbox)
  }

  const onError = () => abort(CLOSE)

  const onMessage = (event: { readonly data: unknown }) => {
    if (ended) return
    const bytes = binaryPayload(event.data)
    if (!bytes) return abort(CLOSE)
    if (bytes.byteLength > MAX_FRAME) return abort(TOO_BIG)
    if (bytes.byteLength < MIN_FRAME) return abort(CLOSE)
    if (queuedBytes + bytes.byteLength > maxWaiting) return abort(CLOSE)
    queuedBytes += bytes.byteLength
    Queue.offerUnsafe(inbox, bytes)
  }

  socket.addEventListener("message", onMessage)
  socket.addEventListener("close", onClose)
  socket.addEventListener("error", onError)

  const carrier: Link.Carrier = {
    describe: () => ({ kind: "websocket" }),
    send: (message) =>
      Effect.gen(function* () {
        if (ended || socket.readyState !== OPEN) return
        const held = socket.bufferedAmount ?? 0
        if (held > WORKERD_MAX_BUFFERED) {
          let watermark = held
          let stalledAt = yield* Clock.currentTimeMillis
          while (!ended && socket.readyState === OPEN && (socket.bufferedAmount ?? 0) > WORKERD_MAX_BUFFERED) {
            yield* Effect.sleep(BUFFER_POLL)
            const current = socket.bufferedAmount ?? 0
            const now = yield* Clock.currentTimeMillis
            if (current < watermark) {
              watermark = current
              stalledAt = now
              continue
            }
            if (now - stalledAt >= stallMillis) {
              abort(CLOSE)
              return
            }
          }
          if (ended || socket.readyState !== OPEN) return
        }
        const sent = Result.try(() => socket.send(message))
        if (Result.isFailure(sent)) abort(CLOSE)
      }),
    receive: Effect.gen(function* () {
      if (aborted) return yield* new Link.Closed()
      const bytes = yield* Queue.take(inbox).pipe(Effect.mapError(() => new Link.Closed()))
      if (aborted) return yield* new Link.Closed()
      queuedBytes = Math.max(0, queuedBytes - bytes.byteLength)
      return bytes
    }),
  }

  return {
    carrier,
    promote: () => {
      maxWaiting = WORKERD_MAX_WAITING
    },
    dispose: abort,
  }
})

export type WorkerdMachineLinkContext = Context.Context<
  Machines.Service | Identity.Service | Global.Service | LocationServiceMap.Service
>

/**
 * Intercepts `GET /api/experimental/machine/link` WebSocket upgrades on Cloudflare Durable Objects
 * using non-hibernating `WebSocketPair` (`server.accept()`), keeping Noise XX cipher state in memory
 * for the connection lifetime and tearing down every socket when the server scope closes.
 *
 * Returns `undefined` synchronously for non-upgrade requests (zero fiber/span overhead), and falls
 * through when `machines` is disabled or `WebSocketPair` is unavailable so the router answers 404.
 */
export const makeWorkerdMachineLink = Effect.fn("MachineLink.workerd")(function* (
  appContext: WorkerdMachineLinkContext,
) {
  const scope = yield* Effect.scope
  const pairFactory = yield* WorkerdWebSocketPair
  const callerContext = yield* Effect.context<never>()
  const runtimeContext = Context.merge(callerContext, appContext)
  const runPromise = Effect.runPromiseWith(runtimeContext)
  const enabled = yield* machinesEnabled.pipe(Effect.provide(appContext))
  const machines = Context.get(appContext, Machines.Service)

  let activeHandshakes = 0
  let scopeClosed = false
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => {
      scopeClosed = true
    }),
  )

  const handle = Effect.fn("MachineLink.workerdUpgrade")(function* () {
    if (scopeClosed) return new Response(null, { status: 503 })
    if (!(yield* enabled)) return undefined
    if (scopeClosed || activeHandshakes >= MAX_HANDSHAKES) return new Response(null, { status: 503 })

    // Claim the handshake slot synchronously before any yield so concurrent upgrades cannot exceed MAX_HANDSHAKES.
    activeHandshakes++
    let released = false
    const releaseHandshake = () => {
      if (released) return
      released = true
      activeHandshakes--
    }

    const pair = pairFactory.create()
    if (!pair) {
      releaseHandshake()
      return undefined
    }
    const [client, server] = pair

    const state = yield* createWorkerdCarrier(server).pipe(Effect.onInterrupt(() => Effect.sync(releaseHandshake)))
    const accepted = Result.try(() => server.accept())
    if (Result.isFailure(accepted)) {
      releaseHandshake()
      state.dispose(CLOSE)
      return new Response(null, { status: 500 })
    }

    const response = Result.try(() => pairFactory.respond(client))
    if (Result.isFailure(response)) {
      releaseHandshake()
      state.dispose(CLOSE)
      return new Response(null, { status: 500 })
    }

    const connection = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            releaseHandshake()
            state.dispose(CLOSE)
          }),
        )
        const link = yield* Link.serve(state.carrier).pipe(Effect.ensuring(Effect.sync(releaseHandshake)))
        state.promote()
        yield* machines.connect(link.machine, link.connection)
      }).pipe(Effect.catch(() => Effect.void)),
    )

    yield* Effect.forkIn(connection, scope, { startImmediately: true })
    return response.success
  })

  return (request: Request): Promise<Response | undefined> | undefined => {
    if (!isWorkerdMachineLinkUpgrade(request)) return undefined
    return runPromise(handle())
  }
})
