import { randomUUID } from "node:crypto"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap } from "effect"
import z from "zod"
import { Log } from "../util/log"

export namespace Trigger {
  const log = Log.create({ service: "trigger" })

  export const Info = z
    .object({
      id: z.string(),
      schedule: z.object({
        type: z.literal("interval"),
        interval: z.number().int().positive(),
      }),
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
