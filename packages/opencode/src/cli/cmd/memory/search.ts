import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { MemoryStore } from "@/self-improvement/memory-store"
import type { AppServices } from "@/effect/app-runtime"
import type { InstanceStore } from "@/project/instance-store"

export const MemorySearchCommand = effectCmd({
  command: "search <query>",
  describe: "search memories by query string",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "search query",
        type: "string",
        demandOption: true,
      })
      .option("type", {
        describe: "filter by memory type (episodic, semantic, procedural, pattern)",
        type: "string",
      })
      .option("limit", {
        describe: "maximum number of results",
        type: "number",
        default: 10,
      }),
  handler: Effect.fn("Cli.MemorySearch")(function* (args) {
    const store = yield* Effect.provide(MemoryStore.Service, MemoryStore.defaultLayer)
    const results = yield* store.search({
      query: args.query,
      type_filter: args.type,
      max_results: args.limit,
    })

    if (results.length === 0) {
      return yield* fail("No memories matched the query")
    }

    const idWidth = 18
    const titleWidth = 30
    const scoreWidth = 8

    console.log(
      "ID".padEnd(idWidth) +
        "TITLE".padEnd(titleWidth) +
        "SCORE".padEnd(scoreWidth) +
        "TYPE LAYER CONTENT",
    )
    console.log("-".repeat(90))

    for (const mem of results) {
      const title =
        mem.title.length > titleWidth - 2
          ? mem.title.slice(0, titleWidth - 3) + "..."
          : mem.title
      const snippet =
        mem.content.length > 40
          ? mem.content.slice(0, 37) + "..."
          : mem.content
      console.log(
        mem.id.padEnd(idWidth) +
          title.padEnd(titleWidth) +
          mem.relevance_score.toFixed(2).padEnd(scoreWidth) +
          mem.type.padEnd(11) +
          mem.layer.padEnd(11) +
          snippet,
      )
    }

    console.log(`\n${results.length} result(s) found`)
  }) as (args: any) => Effect.Effect<any, any, AppServices | InstanceStore.Service>,
})
