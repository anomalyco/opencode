import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({
  title: Schema.optional(
    Schema.String.annotate({
      description:
        "New session title. Omit to get current title. Use 3-7 words normally; '#<number> <title>' for PRs.",
    }),
  ),
})

type Metadata = {}

export const SessionTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "session",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: [
        "Get or rename the current session.",
        "Call without arguments to get the current session title.",
        "Pass a title to rename the session. Renaming is skipped if the user already set a custom title.",
        "Call this tool early once you understand the user's task.",
        "Use a short, descriptive title (3-7 words).",
      ].join("\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const info = yield* session.get(ctx.sessionID)
          if (!params.title)
            return {
              title: info.title,
              output: `Current session title: "${info.title}"`,
              metadata: {},
            }
          if (!Session.isDefaultTitle(info.title))
            return {
              title: info.title,
              output: `Session already has a custom title: "${info.title}". Rename skipped.`,
              metadata: {},
            }
          yield* session.setTitle({
            sessionID: ctx.sessionID,
            title: params.title,
          })
          return {
            title: params.title,
            output: `Session renamed to: "${params.title}"`,
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
