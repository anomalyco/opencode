import { Context, Effect, Fiber, Layer, Scope, Schedule } from "effect"
import { MemoryStore } from "./memory-store"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.heartbeat" })

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/Heartbeat") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* MemoryStore.Service
    const scope = yield* Scope.Scope
    let fiber: Fiber.Fiber<void> | null = null

    const start = Effect.fn("Heartbeat.start")(function* () {
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
      const f = yield* store.touchActive({ minAccessCount: 1 }).pipe(
        Effect.repeat(Schedule.spaced(300_000)),
        Effect.forkIn(scope),
      )
      fiber = f as unknown as Fiber.Fiber<void>
      log.debug("heartbeat touched")
    })

    const stop = Effect.fn("Heartbeat.stop")(function* () {
      if (fiber) {
        yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
        fiber = null
      }
    })

    return Service.of({ start, stop })
  }),
)

export const defaultLayer = layer

export * as Heartbeat from "./heartbeat"
