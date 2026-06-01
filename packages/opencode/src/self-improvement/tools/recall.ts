import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { MemoryStore } from "../memory-store"
import DESCRIPTION from "./recall.txt"

export const Parameters = Schema.Struct({
  query: Schema.String,
  type_filter: Schema.optional(Schema.String),
  max_results: Schema.optional(Schema.Number),
})

type Metadata = {
  result_count: number
  query: string
}

export const RecallTool = Tool.define<typeof Parameters, Metadata, MemoryStore.Service>(
  "recall",
  Effect.gen(function* () {
    const memory = yield* MemoryStore.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const results = yield* memory.search(params)

          const formatted = results
            .map(
              (r) =>
                `- **${r.title}** [${r.type}] (relevance: ${(r.relevance_score * 100).toFixed(0)}%): ${r.content.length > 200 ? r.content.slice(0, 200) + "..." : r.content}`,
            )
            .join("\n")

          return {
            title: `Recalled ${results.length} memor${results.length === 1 ? "y" : "ies"}`,
            output: results.length === 0
              ? "No relevant memories found for the query."
              : `Found ${results.length} relevant memor${results.length === 1 ? "y" : "ies"}:\n${formatted}`,
            metadata: { result_count: results.length, query: params.query },
          }
        }).pipe(Effect.orDie),
    }
  }),
)