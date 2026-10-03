import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { McpToolSearch } from "@/mcp/tool-search"
import { EventV2Bridge } from "@/event-v2-bridge"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "What you want to do, in a few words (e.g. \"create github issue\", \"query metrics\").",
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
    description: "Maximum number of tools to return (default 10).",
  }),
})

export const McpSearchTool = Tool.define(
  "search_tools",
  Effect.gen(function* () {
    const search = yield* McpToolSearch.Service
    const events = yield* EventV2Bridge.Service

    return {
      description:
        "Search the connected MCP servers for a tool that does what you need, when the tool you want is not already listed. Returns matching tool names and descriptions; each match is then available to call directly for the rest of this session. Call this before attempting to use any MCP capability you have not used yet.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx) =>
        Effect.gen(function* () {
          // resolve threads the effective ruleset through ctx.extra; fall back to
          // the agent's own block so permission filtering never widens.
          const ruleset = (ctx.extra?.permission as PermissionV1.Ruleset | undefined) ?? []
          const before = yield* search.resolved(ctx.sessionID)
          const matches = yield* search.search({
            sessionID: ctx.sessionID,
            query: params.query,
            ruleset,
            limit: params.limit,
          })
          const fresh = matches.map((m) => m.id).filter((id) => !before.has(id))
          if (fresh.length) {
            yield* events
              .publish(McpEvent.ToolResolved, { sessionID: ctx.sessionID, tools: fresh })
              .pipe(Effect.ignore)
          }
          const metadata = { count: matches.length, tools: matches.map((m) => m.id) }
          if (matches.length === 0) {
            return {
              title: "search_tools",
              output: `No MCP tools matched "${params.query}".`,
              metadata,
            }
          }
          const lines = matches.map((m) => `- ${m.id}: ${m.description || "(no description)"}`)
          return {
            title: `search_tools: ${matches.length} match${matches.length === 1 ? "" : "es"}`,
            output: [
              `These tools are now available to call directly for the rest of this session:`,
              ...lines,
            ].join("\n"),
            metadata,
          }
        }),
    }
  }),
)
