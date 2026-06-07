import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import DESCRIPTION from "./session-list.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  scope: Schema.optional(Schema.Literals(["local", "global"])).annotate({
    description: "List scope. Default: local",
  }),
  start: Schema.optional(Schema.Number).annotate({
    description: "Only include sessions updated after this Unix timestamp (ms)",
  }),
  search: Schema.optional(Schema.String).annotate({
    description: "Filter sessions by title substring match",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum sessions to return. Default: 20, max: 100",
  }),
})

export const SessionListTool = Tool.define(
  "session_list",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: { scope?: "local" | "global"; start?: number; search?: string; limit?: number },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const scope = params.scope ?? "local"
          const limit = Math.min(params.limit ?? 20, 100)

          const sessions =
            scope === "global"
              ? yield* session.listGlobal({ start: params.start, search: params.search, limit })
              : yield* session.list({ start: params.start, search: params.search, limit })

          const results = sessions.map((s) => ({
            id: s.id,
            title: s.title,
            directory: s.directory,
            time_created: s.time.created,
            time_updated: s.time.updated,
            parent_id: s.parentID,
            agent: s.agent,
          }))

          const output = JSON.stringify(results, null, 2)

          return {
            title: `${results.length} sessions`,
            output,
            metadata: {
              count: results.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
