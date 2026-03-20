import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise, memoMap } from "@/effect/run-service"
import { SessionID } from "./schema"
import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect"
import z from "zod"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  export interface Interface {
    readonly get: (sessionID: SessionID) => Effect.Effect<Info>
    readonly list: () => Effect.Effect<Record<string, Info>>
    readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionStatus") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make(
        Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Info>())),
      )

      const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        return data.get(sessionID) ?? { type: "idle" as const }
      })

      const list = Effect.fn("SessionStatus.list")(function* () {
        return Object.fromEntries(yield* InstanceState.get(state))
      })

      const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
        const data = yield* InstanceState.get(state)
        yield* Effect.promise(() => Bus.publish(Event.Status, { sessionID, status }))
        if (status.type === "idle") {
          yield* Effect.promise(() => Bus.publish(Event.Idle, { sessionID }))
          data.delete(sessionID)
          return
        }
        data.set(sessionID, status)
      })

      return Service.of({ get, list, set })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)
  let rt: ManagedRuntime.ManagedRuntime<Service, never> | undefined

  function runSync<A, E>(effect: Effect.Effect<A, E, Service>) {
    rt ??= ManagedRuntime.make(layer, { memoMap })
    return rt.runSync(effect)
  }

  export function get(sessionID: SessionID): Info {
    return runSync(Service.use((svc) => svc.get(sessionID)))
  }

  export function list(): Record<string, Info> {
    return runSync(Service.use((svc) => svc.list()))
  }

  export function set(sessionID: SessionID, status: Info) {
    runSync(Service.use((svc) => svc.set(sessionID, status)))
  }

  export async function getAsync(sessionID: SessionID) {
    return runPromise((svc) => svc.get(sessionID))
  }
}
