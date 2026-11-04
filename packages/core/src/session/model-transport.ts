export * as SessionModelTransport from "./model-transport.js"

import {
  WebSocketTransport,
  type ChannelObservation,
  type ChannelCheckpoint,
  type WebSocketChannelExchange,
  type WebSocketChannelExecution,
  type WebSocketChannelExecutor,
  type WebSocketConnection,
  type WebSocketConnector,
} from "@opencode/ai/route"
import { AIError, AIErrorReason, TransportError, type TransportOperation } from "@opencode/ai/effect"
import { Hash } from "@opencode/util/hash"
import { Cause, Clock, Context, Duration, Effect, Fiber, Layer, Metric, Queue, Scope, Semaphore, Stream } from "effect"
import { Headers } from "effect/http"
import { Socket } from "effect/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionSchema } from "./schema.js"
import { webSocketConstructor } from "../effect/app-node-platform.js"

const ROTATE_AFTER_MS = 55 * 60 * 1000
const CONNECT_TIMEOUT = "15 seconds"
// Reasoning models can stream nothing for several minutes while still working.
const IDLE_TIMEOUT = "30 minutes"
/** Consecutive exchanges lost to the socket before the Session stays on HTTP. */
const MAX_STREAM_FAILURES = 5
const events = Metric.counter("opencode_session_websocket_events_total", {
  description: "Session WebSocket lifecycle events",
  incremental: true,
})
const metric = (event: string, attributes: Record<string, string> = {}) =>
  Metric.update(events.pipe(Metric.withAttributes({ event, ...attributes })), 1)

interface Active {
  readonly queue: Queue.Queue<string, AIError>
  delivery: "send-attempted" | "provider-observed" | "terminal"
}

type ChannelState =
  | { readonly status: "idle"; readonly checkpoint?: ChannelCheckpoint }
  | { readonly status: "exchanging"; readonly active: Active; readonly staged?: ChannelCheckpoint }
  // A completed exchange's checkpoint waits here until the caller's `complete` commits it.
  | { readonly status: "staged"; readonly token: object; readonly checkpoint: ChannelCheckpoint }
  | { readonly status: "closing" }

interface Channel {
  readonly affinity: string
  readonly connection: WebSocketConnection
  readonly openedAt: number
  state: ChannelState
  reader?: Fiber.Fiber<unknown, unknown>
}

type OwnerState =
  | { readonly status: "socket"; readonly failures: number; readonly channel?: Channel }
  | { readonly status: "http" }
  | { readonly status: "closed" }

interface Owner {
  readonly lock: Semaphore.Semaphore
  state: OwnerState
}

/** Selects the connection for one exchange. Its output feeds the affinity key, so changed headers reopen the socket. */
export interface Handshake {
  readonly url: string
  readonly headers: Record<string, string>
}

/**
 * Per-exchange taps. `handshake` runs before the connection is selected; `send` sees each outbound
 * frame after the driver builds it; `receive` sees each inbound frame before the driver observes it.
 */
export interface Interceptor {
  readonly handshake?: (connect: Handshake) => Effect.Effect<Handshake>
  readonly send?: (frame: string) => Effect.Effect<string>
  readonly receive?: (frame: string) => Effect.Effect<string>
}

export interface Interface {
  readonly bind: (
    sessionID: SessionSchema.ID,
    interceptor?: Interceptor,
    idleTimeout?: number | false,
  ) => WebSocketChannelExecutor
  readonly close: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly closeAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionModelTransport") {}

const transportError = (
  message: string,
  input: {
    readonly operation: TransportOperation
    readonly url?: string
    readonly code?: string
    readonly phase?: TransportError["phase"]
    readonly delivery?: TransportError["delivery"]
  },
) =>
  new AIError({
    reason: new TransportError({ message, transport: "websocket", ...input }),
  })

const annotate = (
  error: AIError,
  input: { readonly phase: TransportError["phase"]; readonly delivery: TransportError["delivery"] },
) => {
  if (error.reason._tag !== "Transport") return error
  return new AIError({
    reason: new TransportError({
      ...error.reason,
      message: error.message,
      cause: error.reason.cause,
      ...input,
    }),
  })
}

const affinity = (exchange: WebSocketChannelExchange) =>
  `${exchange.connect.url}:${Hash.sha256(JSON.stringify(Object.entries(exchange.connect.headers).sort(([a], [b]) => a.localeCompare(b))))}`

const observationFrame = (observation: ChannelObservation) => {
  if (observation.type === "frame" || observation.type === "completed" || observation.type === "incomplete")
    return Effect.succeed(observation.frame)
  return Effect.fail(observation.error)
}

const observationTerminal = (observation: ChannelObservation) => observation.type !== "frame"

export const makeLayer = (connector: WebSocketConnector) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const states = new Map<SessionSchema.ID, Owner>()
      const state = (sessionID: SessionSchema.ID) => {
        const current = states.get(sessionID)
        if (current) return current
        const created: Owner = { lock: Semaphore.makeUnsafe(1), state: { status: "socket", failures: 0 } }
        states.set(sessionID, created)
        return created
      }

      // Only a Session still on the socket can fall back; a closed owner stays closed.
      const useHttp = (owner: Owner) => {
        if (owner.state.status === "socket") owner.state = { status: "http" }
      }

      const activeOf = (state: ChannelState) => (state.status === "exchanging" ? state.active : undefined)

      // Detaches the channel and marks it closing before any effect runs. Returns the state it left,
      // or nothing when the channel was already closing.
      const retire = (owner: Owner, channel: Channel) => {
        if (owner.state.status === "socket" && owner.state.channel === channel)
          owner.state = { status: "socket", failures: owner.state.failures }
        const previous = channel.state
        if (previous.status === "closing") return
        channel.state = { status: "closing" }
        return previous
      }

      const closeChannel = Effect.fn("SessionModelTransport.closeChannel")(function* (owner: Owner, channel: Channel) {
        const previous = retire(owner, channel)
        if (!previous) return
        const active = activeOf(previous)
        if (channel.reader) yield* Fiber.interrupt(channel.reader)
        yield* channel.connection.close
        if (active)
          Queue.failCauseUnsafe(
            active.queue,
            Cause.fail(
              transportError("Session WebSocket closed", {
                operation: "read",
                code: "close",
                phase: "close",
                delivery:
                  active.delivery === "provider-observed" || active.delivery === "terminal" ? "accepted" : "ambiguous",
              }),
            ),
          )
        yield* metric("close")
      })

      const poison = Effect.fn("SessionModelTransport.poison")(function* (
        owner: Owner,
        channel: Channel,
        error: AIError,
      ) {
        const previous = retire(owner, channel)
        if (!previous) return
        const active = activeOf(previous)
        yield* Effect.logDebug("session websocket poisoned", {
          sessionTransport: "websocket",
          code: error.reason._tag === "Transport" ? error.reason.code : error.reason._tag,
          active: active !== undefined,
        })
        if (active) {
          Queue.failCauseUnsafe(active.queue, Cause.fail(error))
          yield* streamFailure(owner)
        }
        yield* metric("protocol_failure")
        yield* channel.connection.close
      })

      // A socket that keeps dying mid-exchange costs a retry every step; after enough consecutive
      // losses the Session stays on HTTP.
      const streamFailure = Effect.fn("SessionModelTransport.streamFailure")(function* (owner: Owner) {
        if (owner.state.status !== "socket") return
        const failures = owner.state.failures + 1
        if (failures < MAX_STREAM_FAILURES) {
          owner.state = { ...owner.state, failures }
          return
        }
        owner.state = { status: "http" }
        yield* Effect.logWarning("session websocket failed repeatedly; using http", {
          sessionTransport: "websocket",
          failures,
        })
        yield* metric("fallback", { reason: "stream_failures" })
      })

      const open = Effect.fn("SessionModelTransport.open")(function* (
        owner: Owner,
        exchange: WebSocketChannelExchange,
        key: string,
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const connection = yield* restore(
              connector.open(exchange.connect).pipe(
                Effect.timeoutOrElse({
                  duration: CONNECT_TIMEOUT,
                  orElse: () =>
                    transportError("Timed out opening the Session WebSocket", {
                      url: exchange.connect.url,
                      operation: "request",
                      code: "connect-timeout",
                      phase: "connect",
                      delivery: "not-sent",
                    }),
                }),
                Effect.withSpan("SessionModelTransport.connect"),
              ),
            )
            if (owner.state.status !== "socket") {
              yield* connection.close
              return yield* transportError("Session WebSocket owner closed while connecting", {
                operation: "request",
                code: "owner-closed",
                phase: "connect",
                delivery: "not-sent",
              })
            }
            const channel: Channel = {
              affinity: key,
              connection,
              openedAt: yield* Clock.currentTimeMillis,
              state: { status: "idle" },
            }
            owner.state = { status: "socket", failures: owner.state.failures, channel }
            channel.reader = yield* connection.messages.pipe(
              Stream.runForEach((message) =>
                Effect.gen(function* () {
                  const active = activeOf(channel.state)
                  if (!active)
                    return yield* transportError("WebSocket data arrived without an active exchange", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "idle-data",
                      phase: "receive",
                    })
                  active.delivery = "provider-observed"
                  if (typeof message !== "string")
                    return yield* transportError("Unsupported binary WebSocket frame", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "message",
                      phase: "receive",
                    })
                  Queue.offerUnsafe(active.queue, message)
                }),
              ),
              Effect.catch((error) =>
                channel.state.status === "closing"
                  ? Effect.void
                  : poison(
                      owner,
                      channel,
                      annotate(error, {
                        phase:
                          error.reason._tag === "Transport" && error.reason.phase === "close" ? "close" : "receive",
                        delivery:
                          channel.state.status === "exchanging" && channel.state.active.delivery !== "send-attempted"
                            ? "accepted"
                            : error.reason._tag === "Transport" && error.reason.code === "1009"
                              ? "rejected"
                              : "ambiguous",
                      }),
                    ),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )
            yield* Effect.logDebug("session websocket connected", {
              sessionTransport: "websocket",
              phase: "connect",
            })
            yield* metric("connect")
            return channel
          }),
        )
      })

      const fallback = (exchange: WebSocketChannelExchange): WebSocketChannelExecution => ({
        frames: exchange.fallback(),
        complete: Effect.void,
      })

      const start = Effect.fn("SessionModelTransport.start")(function* (
        owner: Owner,
        input: WebSocketChannelExchange,
        interceptor?: Interceptor,
        idleTimeout?: number | false,
      ) {
        if (owner.state.status === "closed")
          return yield* transportError("Session WebSocket owner is closed", {
            operation: "request",
            code: "owner-closed",
            phase: "queue",
            delivery: "not-sent",
          })
        if (owner.state.status === "http") return fallback(input)
        const selected = interceptor?.handshake
          ? yield* interceptor.handshake({ url: input.connect.url, headers: { ...input.connect.headers } })
          : undefined
        const exchange: WebSocketChannelExchange = selected
          ? { ...input, connect: { ...input.connect, url: selected.url, headers: Headers.fromInput(selected.headers) } }
          : input
        const key = affinity(exchange)
        const now = yield* Clock.currentTimeMillis
        const current = owner.state.status === "socket" ? owner.state.channel : undefined
        const rotateAfterMs = exchange.connect.rotateAfterMs ?? ROTATE_AFTER_MS
        const rotation = current
          ? current.affinity !== key
            ? "affinity"
            : now - current.openedAt >= rotateAfterMs
              ? "age"
              : undefined
          : undefined
        if (current && rotation) {
          yield* Effect.logDebug("session websocket rotating", {
            sessionTransport: "websocket",
            phase: "connect",
            reason: rotation,
          })
          yield* metric("rotation", { reason: rotation })
          yield* metric("reconnect")
          yield* closeChannel(owner, current)
        }

        const reused = owner.state.status === "socket" ? owner.state.channel : undefined
        if (reused)
          yield* Effect.logDebug("session websocket reused", {
            sessionTransport: "websocket",
            phase: "connect",
          })
        if (reused) yield* metric("reuse")
        const channel = reused
          ? reused
          : yield* open(owner, exchange, key).pipe(
              Effect.catch((error) => {
                if (error.reason._tag === "Transport" && error.reason.code === "owner-closed") return Effect.fail(error)
                // Any connect failure, transient or not, pins the Session to HTTP until restart or move:
                // a network that refuses the upgrade would otherwise charge every step for a failed connect.
                useHttp(owner)
                return Effect.logWarning("session websocket connect failed; using http", {
                  sessionTransport: "websocket",
                  phase: "connect",
                  delivery: "not-sent",
                  code: error.reason._tag === "Transport" ? error.reason.code : error.reason._tag,
                }).pipe(
                  Effect.andThen(metric("connect_failure")),
                  Effect.andThen(metric("fallback")),
                  Effect.as(undefined),
                )
              }),
            )
        if (!channel) return fallback(exchange)

        // A checkpoint the previous caller never committed is dropped, and the request goes out full.
        if (channel.state.status === "staged") channel.state = { status: "idle" }

        const create = yield* exchange.driver
          .create(channel.state.status === "idle" ? channel.state.checkpoint : undefined)
          .pipe(
            Effect.tapError(() => closeChannel(owner, channel)),
            Effect.onInterrupt(() => closeChannel(owner, channel)),
          )
        if (create.mode === "full" && channel.state.status === "idle") channel.state = { status: "idle" }
        const message = interceptor?.send
          ? yield* interceptor.send(create.message).pipe(Effect.onInterrupt(() => closeChannel(owner, channel)))
          : create.message
        yield* Effect.logDebug("session websocket sending", {
          sessionTransport: "websocket",
          phase: "send",
          mode: create.mode,
        })
        const active: Active = {
          queue: yield* Queue.unbounded<string, AIError>(),
          delivery: "send-attempted",
        }
        if (channel.state.status === "idle") channel.state = { status: "exchanging", active }
        const sent = yield* channel.connection.sendText(message).pipe(
          Effect.withSpan("SessionModelTransport.send"),
          Effect.onInterrupt(() => closeChannel(owner, channel)),
          Effect.result,
        )
        if (sent._tag === "Failure") {
          const failure = new AIError({
            reason: AIErrorReason.make({
              ...sent.failure.reason,
              message: sent.failure.message,
              cause: sent.failure.reason.cause,
              http: sent.failure.reason.http ?? channel.connection.http,
            }),
          })
          const notSent = failure.reason._tag === "Transport" && failure.reason.delivery === "not-sent"
          yield* closeChannel(owner, channel)
          if (notSent) {
            yield* metric("fallback")
            return fallback(exchange)
          }
          yield* metric("ambiguous_delivery")
          yield* streamFailure(owner)
          return yield* annotate(failure, { phase: "send", delivery: "ambiguous" })
        }
        yield* metric("send")

        let terminal: ChannelObservation | undefined
        const token = {}
        const frames = Stream.fromQueue(active.queue).pipe(
          Stream.timeoutOrElse({
            duration: idleTimeout === false ? Duration.infinity : (idleTimeout ?? IDLE_TIMEOUT),
            orElse: () =>
              Stream.fail(
                transportError("Timed out waiting for WebSocket data", {
                  url: exchange.connect.url,
                  operation: "read",
                  code: "idle-timeout",
                  phase: "receive",
                  delivery: active.delivery === "provider-observed" ? "accepted" : "ambiguous",
                }),
              ),
          }),
          Stream.mapEffect((frame) => (interceptor?.receive ? interceptor.receive(frame) : Effect.succeed(frame))),
          Stream.mapEffect((frame) => exchange.driver.observe(create, frame)),
          Stream.tap((observation) =>
            Effect.sync(() => {
              if (!observationTerminal(observation)) return
              terminal = observation
              active.delivery = "terminal"
              if (channel.state.status === "exchanging" && channel.state.active === active)
                channel.state = {
                  status: "exchanging",
                  active,
                  staged: observation.type === "completed" ? observation.checkpoint : undefined,
                }
            }),
          ),
          Stream.takeUntil(observationTerminal),
          Stream.mapEffect(observationFrame),
          Stream.ensuring(
            Effect.gen(function* () {
              if (channel.state.status === "exchanging" && channel.state.active === active)
                channel.state = channel.state.staged
                  ? { status: "staged", token, checkpoint: channel.state.staged }
                  : { status: "idle" }
              const pending = yield* Queue.size(active.queue)
              yield* Queue.shutdown(active.queue)
              if (terminal && pending === 0) {
                if (owner.state.status === "socket") owner.state = { ...owner.state, failures: 0 }
                yield* metric("terminal", { type: terminal.type })
                if (terminal.type === "rejected") yield* metric("rejection", { recovery: terminal.recovery })
                // The Codex backend stops serving a connection after any error frame: the next request is
                // never answered and the socket dies with 1006. api.openai.com keeps it open, so reconnecting
                // costs one handshake there. Drop the socket after every error so retries never race that.
                if (terminal.type !== "completed" && terminal.type !== "incomplete") yield* closeChannel(owner, channel)
                return
              }
              yield* metric("cancellation")
              const error = terminal
                ? transportError("WebSocket data arrived after the terminal event", {
                    url: exchange.connect.url,
                    operation: "read",
                    code: "idle-data",
                    phase: "receive",
                    delivery: "accepted",
                  })
                : transportError("Session WebSocket exchange did not reach a terminal event", {
                    url: exchange.connect.url,
                    operation: "read",
                    code: "incomplete",
                    phase: "receive",
                    delivery: active.delivery === "provider-observed" ? "accepted" : "ambiguous",
                  })
              yield* poison(owner, channel, error)
            }),
          ),
          Stream.catch((error) => {
            if (
              error.reason._tag !== "Transport" ||
              error.reason.code !== "1009" ||
              error.reason.delivery !== "rejected"
            )
              return Stream.fail(error)
            useHttp(owner)
            return Stream.unwrap(
              Effect.logWarning("session websocket request too large; using http", {
                sessionTransport: "websocket",
                phase: "close",
                delivery: "rejected",
                code: error.reason.code,
              }).pipe(
                Effect.andThen(metric("fallback", { reason: "message_too_large" })),
                Effect.as(exchange.fallback()),
              ),
            )
          }),
        )
        const complete = Effect.sync(() => {
          if (owner.state.status !== "socket" || owner.state.channel !== channel) return
          if (channel.state.status !== "staged" || channel.state.token !== token) return
          channel.state = { status: "idle", checkpoint: channel.state.checkpoint }
        })
        return { frames, complete, http: channel.connection.http }
      })

      const bind = (
        sessionID: SessionSchema.ID,
        interceptor?: Interceptor,
        idleTimeout?: number | false,
      ): WebSocketChannelExecutor => ({
        execute: (exchange) => {
          const owner = state(sessionID)
          let execution: WebSocketChannelExecution | undefined
          return Effect.succeed({
            get http() {
              return execution?.http
            },
            frames: Stream.unwrap(
              Effect.acquireRelease(owner.lock.take(1), () => owner.lock.release(1), { interruptible: true }).pipe(
                Effect.andThen(start(owner, exchange, interceptor, idleTimeout)),
                Effect.tap((started) =>
                  Effect.sync(() => {
                    execution = started
                  }),
                ),
                Effect.map((started) => started.frames),
              ),
            ),
            complete: Effect.suspend(() => execution?.complete ?? Effect.void),
          })
        },
      })

      const closeOwner = (owner: Owner) => {
        const channel = owner.state.status === "socket" ? owner.state.channel : undefined
        owner.state = { status: "closed" }
        return channel ? closeChannel(owner, channel) : Effect.void
      }
      const close = Effect.fn("SessionModelTransport.close")(function* (sessionID: SessionSchema.ID) {
        const owner = states.get(sessionID)
        if (!owner) return
        states.delete(sessionID)
        yield* closeOwner(owner)
      })
      const closeAll = Effect.suspend(() => {
        const owners = Array.from(states.values())
        states.clear()
        return Effect.forEach(owners, closeOwner, { discard: true })
      })

      yield* Effect.addFinalizer(() => closeAll)
      return Service.of({ bind, close, closeAll })
    }),
  )

export const layer = Layer.unwrap(
  Effect.map(Socket.WebSocketConstructor, (constructor) =>
    makeLayer({
      open: (input) =>
        WebSocketTransport.open(input).pipe(Effect.provideService(Socket.WebSocketConstructor, constructor)),
    }),
  ),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [webSocketConstructor] })
