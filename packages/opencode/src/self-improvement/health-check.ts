import { Context, Effect, Fiber, Layer, Scope, Schedule } from "effect"
import { MemoryStore } from "./memory-store"
import { memoryTable } from "./memory.sql"
import { count, eq, lt } from "@/storage/db"
import * as Database from "@/storage/db"
import type { MemoryRow } from "./memory-store"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.health" })

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/HealthCheck") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* MemoryStore.Service
    const scope = yield* Scope.Scope
    let fiber: Fiber.Fiber<void> | null = null

    const runCheck = Effect.fn("HealthCheck.run")(function* () {
      // Count total memories
      const total = Database.Client()
        .select({ value: count() })
        .from(memoryTable)
        .get() as { value: number } | undefined

      const totalCount = total?.value ?? 0

      // Count memories below decay threshold (orphaned)
      const lowImportance = Database.Client()
        .select({ value: count() })
        .from(memoryTable)
        .where(lt(memoryTable.importance, 0.3))
        .get() as { value: number } | undefined

      const lowCount = lowImportance?.value ?? 0

      // Check for stale memories (not accessed in 7+ days)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      const staleCount = Database.Client()
        .select()
        .from(memoryTable)
        .where(lt(memoryTable.time_last_accessed, sevenDaysAgo))
        .all() as MemoryRow[]

      log.info("health check", {
        totalMemories: totalCount,
        lowImportance: lowCount,
        staleMemories: staleCount.length,
      })

      if (totalCount === 0) log.warn("memory store is empty")
      if (lowCount > 0) log.debug("low-importance memories pending decay", { count: lowCount })
      if (staleCount.length > 0) log.debug("stale memories not accessed in 7+ days", { count: staleCount.length })
    })

    const start = Effect.fn("HealthCheck.start")(function* () {
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
      const f = yield* runCheck().pipe(
        Effect.repeat(Schedule.spaced(600_000)),
        Effect.forkIn(scope),
      )
      fiber = f as unknown as Fiber.Fiber<void>
      log.debug("health check fiber started (10-minute interval)")
    })

    const stop = Effect.fn("HealthCheck.stop")(function* () {
      if (fiber) {
        yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
        fiber = null
      }
    })

    return Service.of({ start, stop })
  }),
)

export const defaultLayer = layer

export * as HealthCheck from "./health-check"
