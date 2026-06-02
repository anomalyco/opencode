import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { MemoryStore } from "@/self-improvement/memory-store"
import { Decay } from "@/self-improvement/decay"
import { Database } from "@opencode-ai/core/database/database"
import { curationLogTable } from "@/self-improvement/curation-log.sql"
import type { AppServices } from "@/effect/app-runtime"
import type { InstanceStore } from "@/project/instance-store"

function generateRunID(): string {
  return "cur_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const CurationRunCommand = effectCmd({
  command: "run",
  describe: "run a manual curation cycle (decay + consolidation)",
  handler: Effect.fn("Cli.CurationRun")(function* (args) {
    const { db } = yield* Database.Service
    const store = yield* Effect.provide(MemoryStore.Service, MemoryStore.defaultLayer)
    const decay = yield* Effect.provide(Decay.Service, Decay.defaultLayer)

    console.log("Starting curation cycle..." + EOL)

    // Phase 1: Decay
    console.log("Phase 1: Running memory decay...")
    const decayResult = yield* decay.run()
    console.log(`  decayed: ${decayResult.decayed}, purged: ${decayResult.purged}` + EOL)

    // Phase 2: Consolidate high-importance memories
    console.log("Phase 2: Consolidating high-importance memories...")
    const topMemories = yield* store.search({ query: "", max_results: 10 })
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
    console.log(`  consolidated: ${consolidated} memories` + EOL)

    // Log the run
    const runID = generateRunID()
    const now = Date.now()
    const stats = {
      decayed: decayResult.decayed,
      purged: decayResult.purged,
      consolidated,
    }

    db.insert(curationLogTable)
      .values({
        id: runID,
        type: "consolidation" as const,
        status: "completed" as const,
        stats_json: JSON.stringify(stats),
        memories_affected: consolidated,
        time_started: now,
        time_completed: now,
      })
      .run()

    console.log(
      `Curation complete: ${decayResult.decayed} decayed, ${decayResult.purged} purged, ${consolidated} consolidated`,
    )
  }) as (args: any) => Effect.Effect<any, any, AppServices | InstanceStore.Service>,
})
