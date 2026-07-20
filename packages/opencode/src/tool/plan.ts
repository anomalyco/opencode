import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import { estimateContext, resolveBuildModel } from "./plan-context"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service
    const configService = yield* Config.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(instance.worktree, Session.plan(info, instance))
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const config = yield* configService.get()
          const build = yield* agents.get("build").pipe(Effect.catch(() => Effect.succeed(undefined)))
          const buildModel = yield* resolveBuildModel({ agent: build, provider })
          const assistant = messages.findLast(
            (item) => item.info.role === "assistant" && item.info.finish && !item.info.error,
          )
          const context =
            buildModel && assistant?.info.role === "assistant"
              ? estimateContext({ cfg: config, model: buildModel, tokens: assistant.info.tokens })
              : undefined
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                header: "Build Agent",
                custom: false,
                options: [
                  {
                    label: "Yes",
                    description: context
                      ? `Switch to build agent and start implementing the plan (using ${context.percent}% of Code mode context)`
                      : "Switch to build agent and start implementing the plan",
                  },
                  {
                    label: "No",
                    description: "Stay with plan agent to continue refining the plan",
                  },
                  {
                    label: "Start new session",
                    description: "Switch to build agent and start implementing the plan in a fresh session",
                    ...(context?.recommended ? { recommended: true } : {}),
                  },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const handoffModel =
            lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : yield* provider.defaultModel()
          const fresh = answers[0]?.[0] === "Start new session"
          const target = fresh
            ? yield* session.create({
                parentID: ctx.sessionID,
                agent: "build",
                model: { id: handoffModel.modelID, providerID: handoffModel.providerID },
              })
            : undefined

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: target?.id ?? ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: handoffModel,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: msg.sessionID,
            type: "text",
            text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Switching to build agent",
            output: fresh
              ? `Created a fresh build session (${target?.id}). Continue implementation there.`
              : "User approved switching to build agent. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
