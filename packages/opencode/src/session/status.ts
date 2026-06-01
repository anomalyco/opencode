import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Effect, Layer, Context, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import path from "node:path"

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
  Status: EventV2.define({
    type: "session.status",
    schema: {
      sessionID: SessionID,
      status: Info,
    },
  }),
  // deprecated
  Idle: EventV2.define({
    type: "session.idle",
    schema: {
      sessionID: SessionID,
    },
  }),
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: (input?: { recursive?: boolean }) => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const directories = new Map<string, Map<SessionID, Info>>()

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")((ctx) =>
        Effect.gen(function* () {
          const result = new Map<SessionID, Info>()
          directories.set(ctx.directory, result)
          yield* Effect.addFinalizer(() => Effect.sync(() => directories.delete(ctx.directory)))
          return result
        }),
      ),
    )

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.get(sessionID) ?? { type: "idle" as const }
    })

    const list = Effect.fn("SessionStatus.list")(function* (input?: { recursive?: boolean }) {
      const current = yield* InstanceState.directory
      const data = yield* InstanceState.get(state)
      if (!input?.recursive) return new Map(data)

      const result = new Map<SessionID, Info>()
      for (const [directory, statuses] of directories) {
        if (!isSameOrChildDirectory(current, directory)) continue
        for (const [sessionID, status] of statuses) {
          result.set(sessionID, status)
        }
      }
      return result
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      yield* events.publish(Event.Status, { sessionID, status })
      if (status.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
        data.delete(sessionID)
        return
      }
      data.set(sessionID, status)
    })

    return Service.of({ get, list, set })
  }),
)

function isSameOrChildDirectory(parent: string, directory: string) {
  const relative = path.relative(parent, directory)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export * as SessionStatus from "./status"
