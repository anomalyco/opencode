import { randomUUID } from "node:crypto"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import z from "zod"
import { Log } from "../util/log"

export namespace Trigger {
  const log = Log.create({ service: "trigger" })

  const Action = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("command"),
      sessionID: SessionID.zod,
      command: z.string(),
      arguments: z.string().optional(),
    }),
  ])

  export const Info = z
    .object({
      id: z.string(),
      schedule: z.object({
        type: z.literal("interval"),
        interval: z.number().int().positive(),
      }),
      action: Action.optional(),
      runs: z.number().int().nonnegative(),
      time: z.object({
        created: z.number().int().nonnegative(),
        last: z.number().int().nonnegative().optional(),
        next: z.number().int().nonnegative(),
      }),
    })
    .meta({
      ref: "Trigger",
    })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z.object({
    interval: z.number().int().min(10).max(86_400_000),
    action: Action.optional(),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  export const Event = {
    Fired: BusEvent.define(
      "trigger.fired",
      z.object({
        triggerID: z.string(),
        runs: z.number().int().nonnegative(),
        at: z.number().int().nonnegative(),
      }),
    ),
  }

  type State = {
    create: (input: CreateInput) => Effect.Effect<Info>
    list: () => Effect.Effect<Info[]>
  }

  export interface Interface {
    readonly create: (input: CreateInput) => Effect.Effect<Info>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Trigger") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const state = yield* InstanceState.make<State>(
        Effect.fn("Trigger.state")(function* () {
          const data = new Map<string, Info>()

          const tick = Effect.fnUntraced(function* () {
            const now = Date.now()
            yield* Effect.forEach(
              Array.from(data.values()).filter((item) => item.time.next <= now),
              (item) =>
                Effect.gen(function* () {
                  const at = Date.now()
                  const next = {
                    ...item,
                    runs: item.runs + 1,
                    time: {
                      ...item.time,
                      last: at,
                      next: at + item.schedule.interval,
                    },
                  }
                  data.set(item.id, next)
                  yield* bus.publish(Event.Fired, {
                    triggerID: item.id,
                    runs: next.runs,
                    at,
                  })
                  const action = item.action
                  if (!action) return
                  const st = yield* Effect.promise(() => SessionStatus.get(action.sessionID))
                  if (st.type !== "idle") return
                  yield* Effect.promise(() =>
                    SessionPrompt.command({
                      sessionID: action.sessionID,
                      command: action.command,
                      arguments: action.arguments ?? "",
                    }),
                  ).pipe(
                    Effect.catchCause((cause) =>
                      Effect.sync(() =>
                        log.error("trigger action failed", {
                          triggerID: item.id,
                          cause: Cause.pretty(cause),
                        }),
                      ),
                    ),
                  )
                }),
              { discard: true },
            )
          })

          yield* tick().pipe(
            Effect.catchCause((cause) => {
              log.error("tick loop failed", { cause: Cause.pretty(cause) })
              return Effect.void
            }),
            Effect.repeat(Schedule.spaced(Duration.millis(10))),
            Effect.forkScoped,
          )

          const create = Effect.fn("Trigger.create")(function* (input: CreateInput) {
            const now = Date.now()
            const item = {
              id: `trg_${randomUUID().replaceAll("-", "")}`,
              schedule: {
                type: "interval" as const,
                interval: input.interval,
              },
              action: input.action,
              runs: 0,
              time: {
                created: now,
                next: now + input.interval,
              },
            } satisfies Info
            data.set(item.id, item)
            return item
          })

          const list = Effect.fn("Trigger.list")(() =>
            Effect.succeed(Array.from(data.values()).sort((a, b) => a.time.created - b.time.created)),
          )

          return { create, list }
        }),
      )

      return Service.of({
        create: Effect.fn("Trigger.create")(function* (input: CreateInput) {
          return yield* InstanceState.useEffect(state, (svc) => svc.create(input))
        }),
        list: Effect.fn("Trigger.list")(function* () {
          return yield* InstanceState.useEffect(state, (svc) => svc.list())
        }),
      })
    }),
  )

  const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function create(input: CreateInput) {
    return runPromise((svc) => svc.create(input))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
