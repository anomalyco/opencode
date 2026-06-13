import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

const globalState = new Map<string, Map<SessionID, Info>>()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const readState = Effect.fn("SessionStatus.readState")(function* () {
      const directory = yield* InstanceState.directory
      return { directory, data: globalState.get(directory) }
    })

    const ensureState = Effect.fn("SessionStatus.ensureState")(function* () {
      const directory = yield* InstanceState.directory
      let data = globalState.get(directory)
      if (!data) {
        data = new Map<SessionID, Info>()
        globalState.set(directory, data)
      }
      return { directory, data }
    })

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const { data } = yield* readState()
      return data?.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const { data } = yield* readState()
      return new Map(data ?? [])
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      yield* bus.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        const { directory, data } = yield* readState()
        yield* bus.publish(Event.Idle, { sessionID })
        if (!data) return
        data.delete(sessionID)
        if (data.size === 0) globalState.delete(directory)
        return
      }
      const { data } = yield* ensureState()
      data.set(sessionID, status)
    })

    return Service.of({ get, list, set })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as SessionStatus from "./status"
