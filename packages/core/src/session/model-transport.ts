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
} from "@opencode-ai/ai/route"
import { AIError, AIErrorReason, TransportError, type TransportOperation } from "@opencode-ai/ai"
import { Hash } from "@opencode-ai/util/hash"
import { Cause, Clock, Context, Effect, Fiber, Layer, Metric, Queue, Scope, Semaphore, Stream } from "effect"
import { Socket } from "effect/unstable/socket"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { SessionSchema } from "./schema.js"
import { webSocketConstructor } from "../effect/app-node-platform.js"

const ROTATE_AFTER_MS = 55 * 60 * 1000
const INBOUND_CAPACITY = 128
const IDLE_TIMEOUT = "5 minutes"
const events = Metric.counter("opencode_session_websocket_events_total", {
  description: "Session WebSocket lifecycle events",
  incremental: true,
})
const metric = (event: string, attributes: Record<string, string> = {}) =>
  Metric.update(events.pipe(Metric.withAttributes({ event, ...attributes })), 1)

type Delivery = "queued" | "connecting" | "ready" | "send-attempted" | "provider-observed" | "terminal"

interface Active {
  readonly queue: Queue.Queue<string, AIError>
  readonly lifecycle: { delivery: Delivery }
}

interface Channel {
  readonly affinity: string
  readonly connection: WebSocketConnection
  readonly openedAt: number
  active?: Active
  closing: boolean
  checkpoint?: ChannelCheckpoint
  pending?: { readonly token: object; readonly checkpoint: ChannelCheckpoint }
  reader?: Fiber.Fiber<unknown, unknown>
}

interface State {
  readonly lock: Semaphore.Semaphore
  closed: boolean
  httpFallback: boolean
  channel?: Channel
}

export interface Interface {
  readonly bind: (sessionID: SessionSchema.ID) => WebSocketChannelExecutor
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
      const states = new Map<SessionSchema.ID, State>()
      const state = (sessionID: SessionSchema.ID) => {
        const current = states.get(sessionID)
        if (current) return current
        const created = { lock: Semaphore.makeUnsafe(1), closed: false, httpFallback: false }
        states.set(sessionID, created)
        return created
      }

      const closeChannel = Effect.fn("SessionModelTransport.closeChannel")(function* (owner: State, channel: Channel) {
        if (owner.channel === channel) owner.channel = undefined
        if (channel.closing) return
        channel.closing = true
        if (channel.reader) yield* Fiber.interrupt(channel.reader)
        yield* channel.connection.close
        if (channel.active)
          Queue.failCauseUnsafe(
            channel.active.queue,
            Cause.fail(
              transportError("Session WebSocket closed", {
                operation: "read",
                code: "close",
                phase: "close",
                delivery:
                  channel.active.lifecycle.delivery === "queued" ||
                  channel.active.lifecycle.delivery === "connecting" ||
                  channel.active.lifecycle.delivery === "ready"
                    ? "not-sent"
                    : channel.active.lifecycle.delivery === "provider-observed" ||
                        channel.active.lifecycle.delivery === "terminal"
                      ? "accepted"
                      : "ambiguous",
              }),
            ),
          )
        yield* metric("close")
      })

      const poison = Effect.fn("SessionModelTransport.poison")(function* (
        owner: State,
        channel: Channel,
        error: AIError,
      ) {
        if (owner.channel === channel) owner.channel = undefined
        if (channel.closing) return
        channel.closing = true
        if (channel.active) Queue.failCauseUnsafe(channel.active.queue, Cause.fail(error))
        yield* metric(
          error.reason._tag === "Transport" && error.reason.code === "queue-overflow"
            ? "queue_overflow"
            : "protocol_failure",
        )
        yield* channel.connection.close
      })

      const open = Effect.fn("SessionModelTransport.open")(function* (
        owner: State,
        exchange: WebSocketChannelExchange,
        key: string,
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const connection = yield* restore(
              connector.open(exchange.connect).pipe(Effect.withSpan("SessionModelTransport.connect")),
            )
            if (owner.closed) {
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
              closing: false,
            }
            owner.channel = channel
            channel.reader = yield* connection.messages.pipe(
              Stream.runForEach((message) =>
                Effect.gen(function* () {
                  const active = channel.active
                  if (!active)
                    return yield* transportError("WebSocket data arrived without an active exchange", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "idle-data",
                      phase: "receive",
                    })
                  active.lifecycle.delivery = "provider-observed"
                  if (typeof message !== "string")
                    return yield* transportError("Unsupported binary WebSocket frame", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "message",
                      phase: "receive",
                    })
                  if (Queue.offerUnsafe(active.queue, message)) return undefined
                  return yield* transportError("Session WebSocket inbound queue overflow", {
                    url: exchange.connect.url,
                    operation: "read",
                    code: "queue-overflow",
                    phase: "receive",
                    delivery: "accepted",
                  })
                }),
              ),
              Effect.catch((error) =>
                channel.closing
                  ? Effect.void
                  : poison(
                      owner,
                      channel,
                      annotate(error, {
                        phase:
                          error.reason._tag === "Transport" && error.reason.phase === "close" ? "close" : "receive",
                        delivery:
                          channel.active?.lifecycle.delivery === "provider-observed" ||
                          channel.active?.lifecycle.delivery === "terminal" ||
                          (error.reason._tag === "Transport" && error.reason.code === "queue-overflow")
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
        owner: State,
        exchange: WebSocketChannelExchange,
        lifecycle: { delivery: Delivery },
      ) {
        if (owner.closed)
          return yield* transportError("Session WebSocket owner is closed", {
            operation: "request",
            code: "owner-closed",
            phase: "queue",
            delivery: "not-sent",
          })
        if (owner.httpFallback) return fallback(exchange)
        const key = affinity(exchange)
        const now = yield* Clock.currentTimeMillis
        const current = owner.channel
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

        lifecycle.delivery = owner.channel ? "ready" : "connecting"
        if (owner.channel)
          yield* Effect.logDebug("session websocket reused", {
            sessionTransport: "websocket",
            phase: "connect",
          })
        if (owner.channel) yield* metric("reuse")
        const channel = owner.channel
          ? owner.channel
          : yield* open(owner, exchange, key).pipe(
              Effect.catch((error) =>
                error.reason._tag === "Transport" && error.reason.code === "owner-closed"
                  ? Effect.fail(error)
                  : Effect.logWarning("session websocket connect failed; using http", {
                      sessionTransport: "websocket",
                      phase: "connect",
                      delivery: "not-sent",
                      code: error.reason._tag === "Transport" ? error.reason.code : error.reason._tag,
                    }).pipe(
                      Effect.andThen(metric("connect_failure")),
                      Effect.andThen(metric("fallback")),
                      Effect.as(undefined),
                    ),
              ),
            )
        if (!channel) return fallback(exchange)
        lifecycle.delivery = "ready"

        if (channel.pending) {
          channel.pending = undefined
          channel.checkpoint = undefined
        }

        const create = yield* exchange.driver.create(channel.checkpoint).pipe(
          Effect.tapError(() => closeChannel(owner, channel)),
          Effect.onInterrupt(() => closeChannel(owner, channel)),
        )
        if (create.mode === "full") channel.checkpoint = undefined
        const active: Active = { queue: yield* Queue.bounded<string, AIError>(INBOUND_CAPACITY), lifecycle }
        channel.active = active
        lifecycle.delivery = "send-attempted"
        const sent = yield* channel.connection.sendText(create.message).pipe(
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
          return yield* annotate(failure, { phase: "send", delivery: "ambiguous" })
        }
        yield* metric("send")

        let terminal: ChannelObservation | undefined
        const token = {}
        const frames = Stream.fromQueue(active.queue).pipe(
          Stream.timeoutOrElse({
            duration: IDLE_TIMEOUT,
            orElse: () =>
              Stream.fail(
                transportError("Timed out waiting for WebSocket data", {
                  url: exchange.connect.url,
                  operation: "read",
                  code: "idle-timeout",
                  phase: "receive",
                  delivery: lifecycle.delivery === "provider-observed" ? "accepted" : "ambiguous",
                }),
              ),
          }),
          Stream.mapEffect((frame) => exchange.driver.observe(create, frame)),
          Stream.tap((observation) =>
            Effect.sync(() => {
              if (!observationTerminal(observation)) return
              terminal = observation
              lifecycle.delivery = "terminal"
              const staged = observation.type === "completed" ? observation.checkpoint : undefined
              if (staged) channel.pending = { token, checkpoint: staged }
              if (observation.type !== "completed" || !staged) channel.checkpoint = undefined
            }),
          ),
          Stream.takeUntil(observationTerminal),
          Stream.mapEffect(observationFrame),
          Stream.ensuring(
            Effect.gen(function* () {
              if (channel.active === active) channel.active = undefined
              const pending = yield* Queue.size(active.queue)
              yield* Queue.shutdown(active.queue)
              if (terminal && pending === 0) {
                yield* metric("terminal", { type: terminal.type })
                if (terminal.type === "rejected") yield* metric("rejection", { recovery: terminal.recovery })
                if (terminal.type === "rejected" && terminal.recovery === "rotate-and-retry-full")
                  yield* closeChannel(owner, channel)
                return
              }
              yield* metric("cancellation")
              channel.checkpoint = undefined
              channel.pending = undefined
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
                    delivery: lifecycle.delivery === "provider-observed" ? "accepted" : "ambiguous",
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
            owner.httpFallback = true
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
          if (owner.channel !== channel || channel.pending?.token !== token) return
          channel.checkpoint = channel.pending.checkpoint
          channel.pending = undefined
        })
        return { frames, complete, http: channel.connection.http }
      })

      const bind = (sessionID: SessionSchema.ID): WebSocketChannelExecutor => ({
        execute: (exchange) => {
          const owner = state(sessionID)
          const lifecycle = { delivery: "queued" as Delivery }
          let execution: WebSocketChannelExecution | undefined
          return Effect.succeed({
            get http() {
              return execution?.http
            },
            frames: Stream.unwrap(
              Effect.acquireRelease(owner.lock.take(1), () => owner.lock.release(1), { interruptible: true }).pipe(
                Effect.andThen(start(owner, exchange, lifecycle)),
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

      const close = Effect.fn("SessionModelTransport.close")(function* (sessionID: SessionSchema.ID) {
        const owner = states.get(sessionID)
        if (!owner) return
        states.delete(sessionID)
        owner.closed = true
        if (owner.channel) yield* closeChannel(owner, owner.channel)
      })
      const closeAll = Effect.suspend(() => {
        const owners = Array.from(states.values())
        states.clear()
        return Effect.forEach(
          owners,
          (owner) => {
            owner.closed = true
            return owner.channel ? closeChannel(owner, owner.channel) : Effect.void
          },
          { discard: true },
        )
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

export const node = makeLocationNode({ service: Service, layer, deps: [webSocketConstructor] })
