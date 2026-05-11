import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Short descriptive title for the current session (3-7 words)" }),
})

type Metadata = {}

export const RenameTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "rename",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: [
        "Rename the current session to reflect what you are working on.",
        "Call this tool early once you understand the user's task.",
        "Use a short, descriptive title (3-7 words).",
      ].join("\n"),
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
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
