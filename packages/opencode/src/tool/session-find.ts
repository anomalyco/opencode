import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import DESCRIPTION from "./session-find.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Title text to search for. Case-insensitive substring match." }),
  scope: Schema.optional(Schema.Literals(["local", "global"])).annotate({
    description: "Search scope. Default: local",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum results. Default: 10, max: 30",
  }),
})

export const SessionFindTool = Tool.define(
  "session_find",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { title: string; scope?: "local" | "global"; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const scope = params.scope ?? "local"
          const limit = Math.min(params.limit ?? 10, 30)

          const sessions =
            scope === "global"
              ? yield* session.listGlobal({ search: params.title, limit })
              : yield* session.list({ search: params.title, limit })

          const results = sessions.map((s) => ({
            id: s.id,
            title: s.title,
            directory: s.directory,
            time_created: s.time.created,
            time_updated: s.time.updated,
            parent_id: s.parentID,
            agent: s.agent,
            model: s.model,
          }))

          const ambiguous = results.length > 1

          const output = JSON.stringify({ results, ambiguous }, null, 2)

          return {
            title: results.length === 1 ? results[0].title : params.title,
            output,
            metadata: {
              count: results.length,
              ambiguous,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
