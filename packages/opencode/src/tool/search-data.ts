import { ToolRuntime } from "@opencode-ai/database/tool/runtime"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query to find tools and data" }),
  type: Schema.optional(Schema.String).annotate({
    description: "Filter by entity type (tool, skill, note)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 10)",
  }),
})

export const SearchDataTool = Tool.define(
  "search_data",
  Effect.gen(function* () {
    const runtime = yield* ToolRuntime

    return {
      description:
        "Search across all available tools and data. Returns ranked results matching your query. Use this to discover dynamic tools, then call them with call_tool.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const limit = params.limit ?? 10
          const results = yield* runtime.searchCatalog(params.query)

          const lines = results.slice(0, limit).map((sig) => {
            const inputKeys = Object.keys(sig.input).join(", ") || "none"
            const outputKeys = Object.keys(sig.output).join(", ") || "any"
            return [
              `[tool] ${sig.name} (score: ${sig.score.toFixed(2)})`,
              `  ${sig.description}`,
              `  inputs: ${inputKeys}`,
              `  outputs: ${outputKeys}`,
            ].join("\n")
          })

          const output =
            lines.length > 0 ? lines.join("\n\n") : `No results found for "${params.query}". Try a different query.`

          return {
            title: `Searched for "${params.query}"`,
            output,
            metadata: { count: results.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
