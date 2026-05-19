import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, SessionID } from "./schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Layer, Context, Schema } from "effect"

export const Info = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("idle"),
  }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: NonNegativeInt,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String),
      }),
    ),
    next: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("busy"),
    queued: Schema.optional(Schema.Array(MessageID)),
  }),
]).annotate({ identifier: "SessionStatus" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Status: BusEvent.define(
    "session.status",
    Schema.Struct({
      sessionID: SessionID,
      status: Info,
    }),
  ),
  // deprecated
  Idle: BusEvent.define(
    "session.idle",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  readonly setQueued: (sessionID: SessionID, messageIDs: MessageID[]) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
    )
    const queued = yield* InstanceState.make(
      Effect.fn("SessionStatus.queued")(() => Effect.succeed(new Map<SessionID, MessageID[]>())),
    )

    function attachQueued(status: Info, messageIDs: MessageID[] | undefined): Info {
      if (!messageIDs?.length) return status
      if (status.type === "retry") return status
      if (status.type === "idle") return { type: "busy", queued: messageIDs }
      return { ...status, queued: messageIDs }
    }

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const queuedData = yield* InstanceState.get(queued)
      return attachQueued(data.get(sessionID) ?? { type: "idle" as const }, queuedData.get(sessionID))
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const data = yield* InstanceState.get(state)
      const queuedData = yield* InstanceState.get(queued)
      const result = new Map(
        Array.from(data, ([sessionID, status]) => [sessionID, attachQueued(status, queuedData.get(sessionID))]),
      )
      for (const [sessionID, messageIDs] of queuedData) {
        if (!result.has(sessionID)) result.set(sessionID, attachQueued({ type: "idle" }, messageIDs))
      }
      return result
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      const queuedData = yield* InstanceState.get(queued)
      yield* bus.publish(Event.Status, { sessionID, status: attachQueued(status, queuedData.get(sessionID)) })
      if (status.type === "idle") {
        yield* bus.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        return
      }
      data.set(sessionID, status)
    })

    const setQueued = Effect.fn("SessionStatus.setQueued")(function* (sessionID: SessionID, messageIDs: MessageID[]) {
      const data = yield* InstanceState.get(queued)
      if (messageIDs.length) data.set(sessionID, [...messageIDs])
      else data.delete(sessionID)
      yield* bus.publish(Event.Status, { sessionID, status: yield* get(sessionID) })
    })

    return Service.of({ get, list, set, setQueued })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as SessionStatus from "./status"
