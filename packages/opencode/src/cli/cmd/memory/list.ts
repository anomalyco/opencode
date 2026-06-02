import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { MemoryStore } from "@/self-improvement/memory-store"
import type { AppServices } from "@/effect/app-runtime"
import type { InstanceStore } from "@/project/instance-store"

export const MemoryListCommand = effectCmd({
  command: "list",
  describe: "list stored memories",
  builder: (yargs) =>
    yargs
      .option("type", {
        describe: "filter by memory type (episodic, semantic, procedural, pattern)",
        type: "string",
      })
      .option("layer", {
        describe: "filter by memory layer (short_term, long_term, semantic, procedural)",
        type: "string",
      })
      .option("limit", {
        describe: "maximum number of memories to return",
        type: "number",
        default: 20,
      })
      .option("offset", {
        describe: "number of memories to skip",
        type: "number",
        default: 0,
      }),
  handler: Effect.fn("Cli.MemoryList")(function* (args) {
    const store = yield* Effect.provide(MemoryStore.Service, MemoryStore.defaultLayer)
    const results = yield* store.search({
      query: "",
      type_filter: args.type,
      max_results: args.limit + args.offset,
    })

    const filtered = args.offset > 0 ? results.slice(args.offset) : results

    if (filtered.length === 0) {
      return yield* fail("No memories found")
    }

    const idWidth = 18
    const titleWidth = 30
    const typeWidth = 12
    const layerWidth = 12

    console.log(
      "ID".padEnd(idWidth) +
        "TITLE".padEnd(titleWidth) +
        "TYPE".padEnd(typeWidth) +
        "LAYER".padEnd(layerWidth) +
        "IMPORTANCE",
    )
    console.log("-".repeat(idWidth + titleWidth + typeWidth + layerWidth + 10))

    for (const mem of filtered) {
      const title =
        mem.title.length > titleWidth - 2
          ? mem.title.slice(0, titleWidth - 3) + "..."
          : mem.title
      console.log(
        mem.id.padEnd(idWidth) +
          title.padEnd(titleWidth) +
          mem.type.padEnd(typeWidth) +
          mem.layer.padEnd(layerWidth) +
          mem.importance.toFixed(2),
      )
    }

    console.log(`\n${filtered.length} memory(ies) shown`)
  }) as (args: any) => Effect.Effect<any, any, AppServices | InstanceStore.Service>,
})
