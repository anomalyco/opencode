export * as SessionModelTransport from "./model-transport.js"

import {
  WebSocketTransport,
  type ChannelObservation,
  type WebSocketChannelExchange,
  type WebSocketChannelExecution,
  type WebSocketChannelExecutor,
  type WebSocketConnection,
  type WebSocketConnector,
} from "@opencode-ai/ai/route"
import { AIError, TransportReason, type TransportOperation } from "@opencode-ai/ai"
import { Hash } from "@opencode-ai/util/hash"
import { Cause, Clock, Context, Effect, Fiber, Layer, Queue, Scope, Semaphore, Stream } from "effect"
import { Socket } from "effect/unstable/socket"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { SessionSchema } from "./schema.js"
import { webSocketConstructor } from "../effect/app-node-platform.js"

const ROTATE_AFTER_MS = 55 * 60 * 1000
const INBOUND_CAPACITY = 128
const IDLE_TIMEOUT = "5 minutes"

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
  poisoned: boolean
  reader?: Fiber.Fiber<unknown, unknown>
}

interface State {
  readonly lock: Semaphore.Semaphore
  closed: boolean
  channel?: Channel
}

export interface Interface {
  readonly bind: (sessionID: SessionSchema.ID) => WebSocketChannelExecutor
  readonly close: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly closeAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionModelTransport") {}

const transportError = (
  method: string,
  message: string,
  input: {
    readonly operation: TransportOperation
    readonly url?: string
    readonly code?: string
    readonly phase?: TransportReason["phase"]
    readonly delivery?: TransportReason["delivery"]
  },
) =>
  new AIError({
    module: "SessionModelTransport",
    method,
    reason: new TransportReason({ message, transport: "websocket", ...input }),
  })

const annotate = (
  error: AIError,
  input: { readonly phase: TransportReason["phase"]; readonly delivery: TransportReason["delivery"] },
) => {
  if (error.reason._tag !== "Transport") return error
  return new AIError({
    module: error.module,
    method: error.method,
    reason: new TransportReason({
      message: error.reason.message,
      transport: error.reason.transport,
      operation: error.reason.operation,
      code: error.reason.code,
      url: error.reason.url,
      http: error.reason.http,
      recovery: error.reason.recovery,
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
        const created = { lock: Semaphore.makeUnsafe(1), closed: false }
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
              transportError("close", "Session WebSocket closed", {
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
      })

      const poison = Effect.fn("SessionModelTransport.poison")(function* (
        owner: State,
        channel: Channel,
        error: AIError,
      ) {
        channel.poisoned = true
        if (owner.channel === channel) owner.channel = undefined
        if (channel.closing) return
        channel.closing = true
        if (channel.active) Queue.failCauseUnsafe(channel.active.queue, Cause.fail(error))
        yield* channel.connection.close
      })

      const open = Effect.fn("SessionModelTransport.open")(function* (
        owner: State,
        exchange: WebSocketChannelExchange,
        key: string,
      ) {
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const connection = yield* restore(connector.open(exchange.connect))
            if (owner.closed) {
              yield* connection.close
              return yield* transportError("open", "Session WebSocket owner closed while connecting", {
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
              poisoned: false,
            }
            owner.channel = channel
            channel.reader = yield* connection.messages.pipe(
              Stream.runForEach((message) =>
                Effect.gen(function* () {
                  const active = channel.active
                  if (!active)
                    return yield* transportError("receive", "WebSocket data arrived without an active exchange", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "idle-data",
                      phase: "receive",
                    })
                  active.lifecycle.delivery = "provider-observed"
                  if (typeof message !== "string")
                    return yield* transportError("receive", "Unsupported binary WebSocket frame", {
                      url: exchange.connect.url,
                      operation: "read",
                      code: "message",
                      phase: "receive",
                    })
                  if (Queue.offerUnsafe(active.queue, message)) return undefined
                  return yield* transportError("receive", "Session WebSocket inbound queue overflow", {
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
          return yield* transportError("start", "Session WebSocket owner is closed", {
            operation: "request",
            code: "owner-closed",
            phase: "queue",
            delivery: "not-sent",
          })
        const key = affinity(exchange)
        const now = yield* Clock.currentTimeMillis
        const current = owner.channel
        const rotateAfterMs = exchange.connect.rotateAfterMs ?? ROTATE_AFTER_MS
        const rotation = current
          ? current.poisoned
            ? "poisoned"
            : current.affinity !== key
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
          yield* closeChannel(owner, current)
        }

        lifecycle.delivery = owner.channel ? "ready" : "connecting"
        if (owner.channel)
          yield* Effect.logDebug("session websocket reused", {
            sessionTransport: "websocket",
            phase: "connect",
          })
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
                    }).pipe(Effect.andThen(Effect.succeed(undefined))),
              ),
            )
        if (!channel) return fallback(exchange)
        lifecycle.delivery = "ready"

        const create = yield* exchange.driver.create(undefined).pipe(
          Effect.tapError(() => closeChannel(owner, channel)),
          Effect.onInterrupt(() => closeChannel(owner, channel)),
        )
        const active: Active = { queue: yield* Queue.bounded<string, AIError>(INBOUND_CAPACITY), lifecycle }
        channel.active = active
        lifecycle.delivery = "send-attempted"
        const sent = yield* channel.connection.sendText(create.message).pipe(
          Effect.onInterrupt(() => closeChannel(owner, channel)),
          Effect.result,
        )
        if (sent._tag === "Failure") {
          const failure = sent.failure
          const notSent = failure.reason._tag === "Transport" && failure.reason.delivery === "not-sent"
          yield* closeChannel(owner, channel)
          if (notSent) return fallback(exchange)
          return yield* annotate(failure, { phase: "send", delivery: "ambiguous" })
        }

        let terminal = false
        const frames = Stream.fromQueue(active.queue).pipe(
          Stream.timeoutOrElse({
            duration: IDLE_TIMEOUT,
            orElse: () =>
              Stream.fail(
                transportError("receive", "Timed out waiting for WebSocket data", {
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
              terminal = true
              lifecycle.delivery = "terminal"
            }),
          ),
          Stream.takeUntil(observationTerminal),
          Stream.mapEffect(observationFrame),
          Stream.ensuring(
            Effect.gen(function* () {
              if (channel.active === active) channel.active = undefined
              const pending = yield* Queue.size(active.queue)
              yield* Queue.shutdown(active.queue)
              if (terminal && pending === 0) return
              const error = terminal
                ? transportError("receive", "WebSocket data arrived after the terminal event", {
                    url: exchange.connect.url,
                    operation: "read",
                    code: "idle-data",
                    phase: "receive",
                    delivery: "accepted",
                  })
                : transportError("execute", "Session WebSocket exchange did not reach a terminal event", {
                    url: exchange.connect.url,
                    operation: "read",
                    code: "incomplete",
                    phase: "receive",
                    delivery: lifecycle.delivery === "provider-observed" ? "accepted" : "ambiguous",
                  })
              yield* poison(owner, channel, error)
            }),
          ),
        )
        return { frames, complete: Effect.void }
      })

      const bind = (sessionID: SessionSchema.ID): WebSocketChannelExecutor => ({
        execute: (exchange) => {
          const owner = state(sessionID)
          const lifecycle = { delivery: "queued" as Delivery }
          return Effect.succeed({
            frames: Stream.unwrap(
              Effect.acquireRelease(owner.lock.take(1), () => owner.lock.release(1), { interruptible: true }).pipe(
                Effect.andThen(start(owner, exchange, lifecycle)),
                Effect.map((execution) => execution.frames),
              ),
            ),
            complete: Effect.void,
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
