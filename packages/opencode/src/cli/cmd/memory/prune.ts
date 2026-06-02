import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { MemoryStore } from "@/self-improvement/memory-store"
import type { AppServices } from "@/effect/app-runtime"
import type { InstanceStore } from "@/project/instance-store"

export const MemoryPruneCommand = effectCmd({
  command: "prune",
  describe: "remove low-importance memories",
  builder: (yargs) =>
    yargs
      .option("importance", {
        describe: "importance threshold — memories below this value are pruned",
        type: "number",
        default: 0.3,
      })
      .option("dryRun", {
        alias: "dry-run",
        describe: "show what would be pruned without deleting",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.MemoryPrune")(function* (args) {
    const store = yield* Effect.provide(MemoryStore.Service, MemoryStore.defaultLayer)
    // NOTE: MemoryStore.search does not support offset, so we use a high limit.
    // If a user has >10k memories this will silently cap, but that is an unlikely edge case.
    const results = yield* store.search({
      query: "",
      max_results: 10000,
    })

    const candidates = results.filter((mem) => mem.importance < args.importance)

    if (candidates.length === 0) {
      console.log("No memories below the importance threshold.")
      return
    }

    if (args.dryRun) {
      console.log(`[dry-run] ${candidates.length} memory(ies) would be pruned (importance < ${args.importance}):`)
      for (const mem of candidates) {
        console.log(`  ${mem.id} ${mem.title} (importance: ${mem.importance.toFixed(2)})`)
      }
      return
    }

    for (const mem of candidates) {
      yield* store.remove(mem.id)
    }

    console.log(`Pruned ${candidates.length} memory(ies) with importance < ${args.importance}`)
  }) as (args: any) => Effect.Effect<any, any, AppServices | InstanceStore.Service>,
})
