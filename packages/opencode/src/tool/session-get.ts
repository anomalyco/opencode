import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import { SessionID } from "../session/schema"
import DESCRIPTION from "./session-get.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  sessionId: Schema.String.annotate({ description: "Session ID to retrieve metadata for" }),
})

export const SessionGetTool = Tool.define(
  "session_get",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { sessionId: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* session.get(SessionID.make(params.sessionId)).pipe(
            Effect.mapError(
              () =>
                new Error(
                  `Session not found: ${params.sessionId}. Use session_find or session_list to discover session IDs.`,
                ),
            ),
          )

          const result = {
            id: info.id,
            title: info.title,
            slug: info.slug,
            directory: info.directory,
            workspace_id: info.workspaceID,
            parent_id: info.parentID,
            agent: info.agent,
            model: info.model,
            version: info.version,
            cost: info.cost,
            tokens: info.tokens,
            time_created: info.time.created,
            time_updated: info.time.updated,
            time_compacting: info.time.compacting,
            time_archived: info.time.archived,
          }

          const output = JSON.stringify(result, null, 2)

          return {
            title: info.title,
            output,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
