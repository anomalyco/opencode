export * as OpenCodeTools from "./opencode.js"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Schema } from "effect"

export const MoveInput = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to move the current session." }),
  directory: AbsolutePath.check(Schema.isMinLength(1)).annotate({
    description: "Destination directory, relative to the target session's directory or absolute. Supports ~.",
  }),
})

const MoveOutput = Schema.Struct({ sessionID: Session.ID, directory: AbsolutePath })

export const Plugin = {
  id: "opencode.tools",
  effect: Effect.fn("OpenCodeTools.Plugin")(function* (ctx: Context) {
    yield* ctx.tool
      .transform((draft) => {
        draft.namespace({ name: "opencode", description: "OpenCode session and runtime tools." })
        draft.add({
          name: "session_move",
          description:
            "Move a session to another directory, or omit sessionID to move the current session. The current session moves at the next safe boundary; do not run destination-dependent tools in the same execute call.",
          input: MoveInput,
          output: MoveOutput,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const sessionID = input.sessionID ?? context.sessionID
              yield* ctx.session.move({
                sessionID,
                directory: input.directory,
                delivery: "steer",
              })
              return {
                output: { sessionID, directory: input.directory },
                content: `Moved session ${sessionID} to ${input.directory}.`,
              }
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to move session to ${input.directory}`, error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
