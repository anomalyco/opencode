import * as Tool from "./tool"
import DESCRIPTION from "./send_message.txt"
import * as Team from "@/team/team"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"

const id = "send_message"

export const Parameters = Schema.Struct({
  team_id: Schema.String.annotate({ description: "The team ID" }),
  to: Schema.String.annotate({
    description: 'The session ID of the teammate to message, or "*" to broadcast to all teammates',
  }),
  content: Schema.String.annotate({ description: "The message content" }),
})

export const SendMessageTool = Tool.define(
  id,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const inst = yield* InstanceState.context

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: id,
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const msg = yield* Team.sendMessage(fs, inst.worktree, {
            teamID: params.team_id,
            from: ctx.sessionID,
            to: params.to,
            content: params.content,
          })

          // Also check for any incoming messages for this session
          const incoming = yield* Team.readMessages(fs, inst.worktree, {
            teamID: params.team_id,
            sessionID: ctx.sessionID,
          })

          const output = [`Message sent to ${params.to === "*" ? "all teammates" : params.to}.`]

          if (incoming.length > 0) {
            output.push("", `You have ${incoming.length} message(s):`)
            for (const m of incoming) {
              output.push(`  [from ${m.from}]: ${m.content}`)
            }
          }

          return {
            title: `Message sent to ${params.to === "*" ? "all" : params.to}`,
            metadata: { messageId: msg.id },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
