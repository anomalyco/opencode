import { Effect, Schema } from "effect"
import { Memory } from "@/memory"
import DESCRIPTION from "./memory.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  operation: Schema.optional(Schema.Literal("search")).annotate({
    description: "Memory operation to perform (currently only 'search')",
  }),
  query: Schema.String.annotate({ description: "Search query (BM25 over markdown bodies)" }),
  scope: Schema.optional(Schema.Literals(["global", "projects", "sessions"])).annotate({
    description: "Filter by memory scope",
  }),
  scope_id: Schema.optional(Schema.String).annotate({
    description: "Filter by scope id (e.g., session id, task id, project id hash)",
  }),
  type: Schema.optional(Schema.String).annotate({
    description: "Filter by memory type (memory, checkpoint, progress, notes, free, ...)",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max results (default 10)" }),
})

export const MemoryTool = Tool.define(
  "memory",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const results = yield* memory.search({
            query: args.query,
            scope: args.scope,
            scope_id: args.scope_id,
            type: args.type,
            limit: args.limit,
          })
          if (results.length === 0) {
            return {
              title: `Memory search: 0 results`,
              output: [
                `No matches for "${args.query}".`,
                ``,
                `0 results does NOT mean it was never recorded. Escalate before giving up:`,
                `1. Retry with FEWER / more distinctive terms - queries are OR-joined and`,
                `   ranked, so 1-2 rare words (an exact ID, function name, flag) beat a long`,
                `   descriptive phrase. Drop generic words ("config", "params", "database").`,
                `2. For a LITERAL string the tokenizer splits (URLs like postgres://..., ports`,
                `   like 5433, paths) - Grep the memory dir directly.`,
                `Widen scope progressively: session -> project -> global.`,
              ].join("\n"),
              metadata: { count: 0 },
            }
          }
          const lines = [
            `Found ${results.length} match${results.length === 1 ? "" : "es"} (BM25-ranked, best first).`,
            `A hit here is authoritative - use it even if a parallel/sibling query returned nothing.`,
            `If you need the FULL body (snippets are truncated), Read the path.`,
            ``,
          ]
          for (const r of results) {
            lines.push(`### ${r.path}`)
            lines.push(
              `Scope: ${r.scope}${r.scope_id ? `/${r.scope_id}` : ""}, Type: ${r.type}, Score: ${r.score.toFixed(3)}`,
            )
            lines.push(r.snippet)
            lines.push("")
          }
          return {
            title: `Memory search: ${results.length} result${results.length === 1 ? "" : "s"}`,
            output: lines.join("\n"),
            metadata: { count: results.length },
          }
        }),
    }
  }),
)
