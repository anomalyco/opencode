import { Context, Effect, Fiber, Layer, Scope, Schedule } from "effect"
import { MemoryStore } from "./memory-store"
import { Decay } from "./decay"
import { PatternExtractor } from "./pattern-extractor"
import { curationLogTable } from "./curation-log.sql"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.curation" })

export interface Interface {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/Curation") {}

function generateCurationRunID(): string {
  return "cur_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* MemoryStore.Service
    const decay = yield* Decay.Service
    const patternExtractor = yield* PatternExtractor.Service
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope
    let fiber: Fiber.Fiber<void> | null = null

    const runCycle = Effect.fn("Curation.runCycle")(function* () {
      // Phase 1: Decay — reduce importance of old memories, purge very low ones
      const decayResult = yield* decay.run()

      // Phase 2: Pattern extraction — discover patterns across recent memories
      const patternResult = yield* patternExtractor.extractPatterns({ sessionID: "curation" })

      // Phase 3: Consolidation — evolve high-importance memories
      const topMemories = yield* store.search({ query: "", max_results: 5 })
      let consolidated = 0
      for (const mem of topMemories) {
        if (mem.importance >= 0.7) {
          yield* store.update(mem.id, {
            confidence: Math.min(mem.confidence + 0.05, 1),
            time_last_evolved: Date.now(),
          })
          consolidated++
        }
      }

      // Log the curation cycle to curation_run_log
      const runID = generateCurationRunID()
      const now = Date.now()
      const stats = {
        decayed: decayResult.decayed,
        purged: decayResult.purged,
        patternsFound: patternResult.patternsFound,
        consolidated,
      }

      yield* db
        .insert(curationLogTable)
        .values({
          id: runID,
          type: "consolidation",
          status: "completed",
          stats_json: JSON.stringify(stats),
          memories_affected: consolidated,
          time_started: now,
          time_completed: now,
        })
        .pipe(Effect.orDie)

      log.info("curation cycle complete", { decay: decayResult, pattern: patternResult, consolidated })
    })

    const start = Effect.fn("Curation.start")(function* () {
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
      const f = yield* runCycle().pipe(
        Effect.repeat(Schedule.spaced(900_000)),
        Effect.forkIn(scope),
      )
      fiber = f as unknown as Fiber.Fiber<void>
      log.info("curation fiber started (15-minute interval)")
    })

    const stop = Effect.fn("Curation.stop")(function* () {
      if (fiber) {
        yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
        fiber = null
      }
    })

    return Service.of({ start, stop })
  }),
)

export const defaultLayer = Layer.provide(layer, Database.defaultLayer)

export * as Curation from "./curation"
