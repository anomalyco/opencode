export * as SessionMoveTool from "./session-move.js"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { Global } from "@opencode-ai/util/global"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { AbsolutePath } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionMove } from "../../session/move.js"

export const name = "session_move"

export const Input = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to move the current session." }),
  directory: AbsolutePath.check(Schema.isMinLength(1)).annotate({
    description: "Destination directory, relative to the target session's directory or absolute. Supports ~.",
  }),
  queue: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Queue the move instead of steering it at the next safe boundary.",
  }),
})

const Output = Schema.Struct({ sessionID: Session.ID, directory: AbsolutePath })

export const Plugin = {
  id: "opencode.tool.session-move",
  effect: Effect.fn("SessionMoveTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const permission = yield* Permission.Service
    const global = yield* Global.Service

    yield* ctx.tool
      .transform((draft) => {
        draft.namespace({ name: "opencode", description: "OpenCode session and runtime tools." })
        draft.add({
          name,
          description:
            "Move a session to another directory, or omit sessionID to move the current session. The current session moves at the next safe boundary; do not run destination-dependent tools in the same execute call.",
          input: Input,
          output: Output,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const sessionID = input.sessionID ?? context.sessionID
              const session = yield* sessions.get(sessionID)
              const directory = SessionMove.resolveDirectory(input.directory, session.location.directory, global.home)
              yield* permission.assert({
                action: `opencode_${name}`,
                resources: [directory],
                save: [directory],
                metadata: { sessionID, directory },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* sessions.move({
                sessionID,
                directory,
                delivery: input.queue ? "queue" : "steer",
              })
              return {
                output: { sessionID, directory },
                content: `Moving session ${sessionID} to ${directory}.`,
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
