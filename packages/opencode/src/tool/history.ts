import { Effect, Schema } from "effect"
import { History } from "@/history"
import DESCRIPTION from "./history.txt"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

const KIND = Schema.Literals(["user_text", "assistant_text", "tool_input", "tool_error", "reasoning", "tool_output"])

// around() output can easily be tens of KB (multi-message contexts with full
// part bodies). Capping below the global MAX_BYTES nudges agents toward
// "search -> message_id -> targeted Read" instead of one giant inline dump.
const AROUND_MAX_BYTES = 20 * 1024

export const Parameters = Schema.Struct({
  operation: Schema.Literals(["search", "around"]).annotate({
    description: "search: BM25; around: pull message context",
  }),
  // search params
  query: Schema.optional(Schema.String).annotate({
    description: "BM25 query over text/tool bodies. Required for operation=search.",
  }),
  scope: Schema.optional(Schema.Literals(["project", "global"])).annotate({ description: "Default project." }),
  session_id: Schema.optional(Schema.String).annotate({
    description: "Filter to one session (search), or the anchor's session (around).",
  }),
  kind: Schema.optional(Schema.Array(KIND)).annotate({ description: "Filter to specific message/tool kinds." }),
  tool_name: Schema.optional(Schema.String).annotate({ description: "Filter to a specific tool (e.g. shell, read)" }),
  time_after: Schema.optional(Schema.Number).annotate({ description: "Unix ms" }),
  time_before: Schema.optional(Schema.Number).annotate({ description: "Unix ms" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max 50, default 10" }),
  // around params
  message_id: Schema.optional(Schema.String).annotate({
    description: "Anchor message id. Required for operation=around.",
  }),
  before: Schema.optional(Schema.Number).annotate({ description: "Default 5" }),
  after: Schema.optional(Schema.Number).annotate({ description: "Default 5" }),
})

export const HistoryTool = Tool.define(
  "history",
  Effect.gen(function* () {
    const history = yield* History.Service
    const truncate = yield* Truncate.Service
    const agents = yield* Agent.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (args.operation === "search") {
            if (!args.query) {
              return {
                title: "History search: missing query",
                output: "operation=search requires a `query` argument.",
                metadata: { count: 0 },
              }
            }
            const hits = yield* history.search({
              query: args.query,
              scope: args.scope,
              session_id: args.session_id,
              kind: args.kind ? [...args.kind] : undefined,
              tool_name: args.tool_name,
              time_after: args.time_after,
              time_before: args.time_before,
              limit: args.limit,
            })
            if (hits.length === 0) {
              return {
                title: "History search: 0 matches",
                output: `0 matches for "${args.query}". Try memory search if you haven't, or broaden the query.`,
                metadata: { count: 0 },
              }
            }
            const lines = [`Found ${hits.length} match${hits.length === 1 ? "" : "es"}:`, ""]
            for (const h of hits) {
              const kindLabel = h.tool_name ? `${h.kind} - ${h.tool_name}` : h.kind
              lines.push(`### ${h.session_id} ${h.message_id}  (${kindLabel})`)
              lines.push(`Time: ${new Date(h.time_created).toISOString()}, Score: ${h.score.toFixed(3)}`)
              lines.push(h.snippet)
              lines.push("")
            }
            return {
              title: `History search: ${hits.length} match${hits.length === 1 ? "" : "es"}`,
              output: lines.join("\n"),
              metadata: { count: hits.length },
            }
          }

          // operation=around
          if (!args.message_id) {
            return {
              title: "History around: missing message_id",
              output: "operation=around requires a `message_id` argument.",
              metadata: { count: 0 },
            }
          }
          const around = yield* history.around({
            message_id: args.message_id,
            session_id: args.session_id,
            before: args.before,
            after: args.after,
          })
          if (around.messages.length === 0) {
            return {
              title: "History around: anchor not found",
              output: `No message with id ${args.message_id}.`,
              metadata: { count: 0 },
            }
          }
          const lines = [
            `Session ${around.session_id}, ${around.messages.length} messages (anchor ${args.message_id}):`,
            "",
          ]
          for (const m of around.messages) {
            const prefix = m.matched ? ">>>" : "---"
            lines.push(`${prefix} ${m.message_id} (${new Date(m.time_created).toISOString()})`)
            for (const p of m.parts) {
              const head = p.tool_name ? `${p.type} (${p.tool_name})` : p.type
              lines.push(`  ${p.role} - ${head}:`)
              lines.push(
                p.text
                  .split("\n")
                  .map((l) => `    ${l}`)
                  .join("\n"),
              )
            }
            lines.push("")
          }
          const rawOutput = lines.join("\n")
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(rawOutput, { maxBytes: AROUND_MAX_BYTES }, agent)
          return {
            title: `History around ${args.message_id}`,
            output: truncated.content,
            metadata: {
              count: around.messages.length,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }),
    }
  }),
)
