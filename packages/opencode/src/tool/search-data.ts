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
        "Search across all available tools, skills, notes, and other data. Returns ranked results with names, descriptions, and schemas. After finding a tool, use call_tool to execute it by name with JSON-encoded arguments matching its input schema.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const limit = params.limit ?? 10
          const results = yield* runtime.searchCatalog(params.query)

          const lines = results.slice(0, limit).map((sig) => {
            const inputKeys =
              Object.entries(sig.input)
                .map(([k, t]) => `${k} (${t})`)
                .join(", ") || "none"
            const outputKeys =
              Object.entries(sig.output)
                .map(([k, t]) => `${k} (${t})`)
                .join(", ") || "any"
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
