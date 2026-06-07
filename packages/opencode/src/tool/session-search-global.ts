import { Effect, Schema } from "effect"
import { SessionSearch } from "./session-search/index"
import DESCRIPTION from "./session-search-global.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query text to find in session transcripts across all projects" }),
  exact: Schema.optional(Schema.Boolean).annotate({
    description: "Exact phrase matching only. Default: false",
  }),
  semantic: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable Jina-powered semantic search for better results. Requires Jina API key in config. Default: false",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Maximum results. Default: 10, max: 50" }),
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "..."
}

export const SessionSearchGlobalTool = Tool.define(
  "session_search_global",
  Effect.gen(function* () {
    const search = yield* SessionSearch

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx) =>
        Effect.gen(function* () {
          const results = yield* search.search({
            query: params.query,
            scope: "global",
            semantic: params.semantic,
            exact: params.exact,
            limit: clamp(params.limit ?? 10, 1, 50),
          })

          if (results.length === 0) {
            return {
              title: params.query,
              output: "No matching sessions found.",
              metadata: { matches: 0, mode: "lexical" },
            }
          }

          const formatted = results.map((r) => ({
            sessionId: r.sessionId,
            sessionTitle: r.sessionTitle,
            messageId: r.messageId,
            content: truncateSnippet(r.content, 500),
            score: r.score,
            mode: r.mode,
            role: r.role,
            createdAt: r.createdAt,
          }))

          return {
            title: params.query,
            output: JSON.stringify(formatted, null, 2),
            metadata: {
              matches: results.length,
              mode: results[0]?.mode ?? "lexical",
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
