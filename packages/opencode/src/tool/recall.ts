import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./recall.txt"
import { Recall } from "@opencode-ai/core/recall/indexer"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Natural language query against past conversation transcripts (all local sessions)",
  }),
  limit: Schema.optional(
    Schema.Int.annotate({ description: "Maximum number of hits to return (default 5)" }),
  ),
})

export const RecallTool = Tool.define(
  "recall",
  Effect.gen(function* () {
    const recall = yield* Recall.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const hits = yield* recall.search({ query: args.query, limit: args.limit ?? 5 })
          const sessions = [...new Set(hits.map((hit) => hit.sessionID))]
          if (hits.length === 0) {
            return {
              title: `recall ${args.query}`,
              metadata: { count: 0, sessions },
              output: `No transcript matches for "${args.query}".`,
            }
          }
          const output = hits
            .map((hit, index) => {
              const snippet = hit.text.length > 600 ? `${hit.text.slice(0, 600)}…` : hit.text
              return `[${index + 1}] session=${hit.sessionID} score=${hit.score.toFixed(3)}\n${snippet}`
            })
            .join("\n\n---\n\n")
          return {
            title: `recall ${args.query}`,
            metadata: { count: hits.length, sessions },
            output,
          }
        }),
    }
  }),
)
