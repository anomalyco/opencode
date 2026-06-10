import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Memory } from "@/memory/memory"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Search query to find relevant memories. Use natural language describing what you want to recall.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 10)",
  }),
})

export const MemorySearchTool = Tool.define<typeof Parameters, {}, Memory.Service>(
  "memory_search",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Search stored long-term memories using semantic similarity. Use this at the start of a task or when you need to recall information about the user, project context, past decisions, or preferences. Results are ranked by relevance score (0-1). Falls back to keyword search if semantic search is unavailable.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const results = yield* memory.search(params.query, { limit: params.limit })

          const lines = results.map((r) =>
            [
              `[${r.score.toFixed(3)}] ${r.content}`,
              r.metadata ? `  metadata: ${JSON.stringify(r.metadata)}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          )

          const output = lines.length > 0
            ? lines.join("\n\n")
            : `No memories found for "${params.query}".`

          return {
            title: `Found ${results.length} memories for "${params.query}"`,
            output,
            metadata: { count: results.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
