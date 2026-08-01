export * as AutomationScheduler from "./scheduler"

import { Context, Effect, Layer, Schedule as EffectSchedule, Scope } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { Automation } from "./automation"

export interface Interface {
  readonly start: Effect.Effect<void, never, Scope.Scope>
  readonly stop: Effect.Effect<void, never>
  readonly init: () => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AutomationScheduler") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const automation = yield* Automation.Service
    let running = false

    const start: Effect.Effect<void, never, Scope.Scope> = Effect.gen(function* () {
      if (running) return
      running = true

      const loop = Effect.gen(function* () {
        const triggers = yield* automation.list()
        const now = new Date()
        for (const trigger of triggers) {
          if (!trigger.enabled) continue
          if (trigger.schedule.type !== "cron") continue
          if (!isCronDue(trigger.schedule.expression, now)) continue
          yield* automation.fire(trigger.id).pipe(Effect.ignore)
        }
      })

      yield* Effect.forkScoped(Effect.repeat(loop, EffectSchedule.spaced("1 minute")))
    })

    const stop = Effect.void

    const init = () => start

    return Service.of({ start, stop, init })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Automation.node] })

function parseCronField(field: string, min: number, max: number): (value: number) => boolean {
  if (field === "*") return () => true
  if (field.includes("/")) {
    const [range, step] = field.split("/")
    const stepNum = parseInt(step!, 10)
    if (range === "*") return (value: number) => (value - min) % stepNum === 0
  }
  if (field.includes(",")) {
    const values = field.split(",").map((v) => parseInt(v, 10))
    return (value: number) => values.includes(value)
  }
  if (field.includes("-")) {
    const [start, end] = field.split("-").map((v) => parseInt(v, 10))
    return (value: number) => value >= start! && value <= end!
  }
  const exact = parseInt(field, 10)
  return (value: number) => value === exact
}

export function isCronDue(expression: string, now: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  const checks = [
    parseCronField(minute!, 0, 59)(now.getMinutes()),
    parseCronField(hour!, 0, 23)(now.getHours()),
    parseCronField(dayOfMonth!, 1, 31)(now.getDate()),
    parseCronField(month!, 1, 12)(now.getMonth() + 1),
    parseCronField(dayOfWeek!, 0, 6)(now.getDay()),
  ]

  return checks.every(Boolean)
}
