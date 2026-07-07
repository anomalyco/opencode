import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigWorkflowV1 } from "@opencode-ai/core/v1/config/workflow"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Question } from "../question"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./review-exit.txt"

export const Parameters = Schema.Struct({})

export const ReviewExitTool = Tool.define(
  "review_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const agents = yield* Agent.Service
    const fsys = yield* FSUtil.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const info = yield* session.get(ctx.sessionID)
          const cfg = yield* config.get()
          const reviewer = ConfigWorkflowV1.roles(cfg.workflow).reviewer
          if (!reviewer)
            return {
              title: "No reviewer configured",
              output:
                "No workflow reviewer is configured, so there is no review agent to hand off to. Continue without a review.",
              metadata: {},
            }
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Implementation is complete. Would you like to switch to the ${reviewer} agent to review the changes?`,
                header: "Review Agent",
                custom: false,
                options: [
                  { label: "Yes", description: `Switch to ${reviewer} agent and review the implementation` },
                  { label: "No", description: "Stay with the current agent to continue working" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          const reviewerAgent = yield* agents.get(reviewer)
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(Effect.orDie)
          const lastUser = messages.findLast((item) => item.info.role === "user" && item.info.model)
          const model =
            reviewerAgent?.model ??
            (lastUser?.info.role === "user" && lastUser.info.model
              ? lastUser.info.model
              : yield* provider.defaultModel())

          const plan = Session.plan(info, instance)
          const planExists = yield* fsys.existsSafe(plan)
          const against = planExists ? ` against the plan at ${path.relative(instance.worktree, plan)}` : ""

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: reviewer,
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `The implementation is complete. Review the changes made in this session${against} and report your findings.`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: `Switching to ${reviewer} agent`,
            output: `User approved switching to ${reviewer} agent for review. Wait for further instructions.`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
