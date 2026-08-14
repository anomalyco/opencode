import path from "path"
import { SessionV1 } from "@moks/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Hiring plan at ${plan} is complete. Switch to recruit and execute it (score / outreach / commit as planned)?`,
                header: "Recruit",
                custom: false,
                options: [
                  {
                    label: "Yes",
                    description: "Switch to recruit and run the hiring plan",
                  },
                  { label: "No", description: "Stay in plan mode and refine the strategy" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "recruit",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The hiring plan at ${plan} has been approved. Execute it as recruit: load req context, score with cited evidence, draft outreach when planned (never send), and record dispositions only via moks commit/push. Prefer skills and decision verbs; edit only notes under .moks/ if needed.`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to recruit",
            output: "User approved switching to recruit to execute the hiring plan. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
