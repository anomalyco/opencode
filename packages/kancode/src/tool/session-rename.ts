import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./session-rename.txt"
import { Session } from "@/session/session"

const TITLE_MAX = 100

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "New title for the current session" }),
})

type Metadata = {
  title: string
  previousTitle?: string
}

function normalizeTitle(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= TITLE_MAX) return trimmed
  return trimmed.substring(0, TITLE_MAX - 3) + "..."
}

export const SessionRenameTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "session_rename",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const title = normalizeTitle(params.title)
          if (!title) return yield* Effect.fail(new Error("title must be a non-empty string"))

          // Session-scoped pattern + metadata so cruise_control does not treat
          // this as an unscoping filesystem wildcard write.
          yield* ctx.ask({
            permission: "session_rename",
            patterns: ["session"],
            always: ["*"],
            metadata: {
              sessionID: ctx.sessionID,
              scope: "session",
              kind: "session_title",
              title,
            },
          })

          const info = yield* session.get(ctx.sessionID).pipe(Effect.orDie)
          const previousTitle = info.title

          yield* session.setTitle({ sessionID: ctx.sessionID, title })

          return {
            title: "Renamed session",
            output: previousTitle === title ? `Session title is already "${title}".` : `Session renamed to "${title}".`,
            metadata: {
              title,
              previousTitle,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
