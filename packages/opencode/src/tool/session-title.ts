import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "../session/session"
import DESCRIPTION from "./session-title.txt"

export const Parameters = Schema.Struct({
  title: Schema.NonEmptyString.annotate({
    description: "The new session title. A single line of at most 50 characters.",
  }),
})

type Metadata = {}

export const SessionTitleTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "session_title",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "session_title",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const title = params.title.trim()
          if (!title) {
            return {
              title: "Rename failed",
              output: "Title must not be empty. Please provide a non-empty title.",
              metadata: {},
            }
          }
          const shortened = title.length > 100 ? title.substring(0, 97) + "..." : title
          yield* sessions.setTitle({ sessionID: ctx.sessionID, title: shortened })

          return {
            title: shortened,
            output: `Session renamed to "${shortened}"`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
