import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { type SessionID, MessageID, PartID } from "../session/schema"
import * as Tool from "./tool"
import DESCRIPTION from "./autopilot-exit.txt"

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

export const Parameters = Schema.Struct({})

export const AutopilotExitTool = Tool.define(
  "autopilot_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "autopilot_exit",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Autopilot completed. Briefly summarize what was accomplished.",
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Exited autopilot",
            output: "Autopilot completed and switched to build for a summary.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
