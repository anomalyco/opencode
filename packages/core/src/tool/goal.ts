export * as GoalTool from "./goal"

import { Effect, Layer, Schema } from "effect"
import { SessionGoal } from "../session/goal"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { PermissionV2 } from "../permission"
import { ToolFailure } from "@opencode-ai/llm"

export const name = "goal"

export const Input = Schema.Struct({
  action: Schema.Literal("update", "pause", "resume", "complete"),
  text: Schema.optional(Schema.String),
  verification: Schema.optional(Schema.String),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({
  goal: Schema.NullOr(SessionGoal.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => (output.goal ? JSON.stringify(output.goal) : "cleared")

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const goals = yield* SessionGoal.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Manage the active per-session goal. Use sparingly. Allowed actions: update (change text), pause, resume, complete (only after verification). Provide verification evidence when completing.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "goal",
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              if (input.action === "update") {
                if (!input.text) return { goal: yield* goals.get(context.sessionID) }
                const g = yield* goals.update({ sessionID: context.sessionID, text: input.text })
                return { goal: g ?? (yield* goals.get(context.sessionID)) ?? null }
              }
              if (input.action === "pause") {
                const g = yield* goals.pause(context.sessionID)
                return { goal: g ?? null }
              }
              if (input.action === "resume") {
                const g = yield* goals.resume(context.sessionID)
                return { goal: g ?? null }
              }
              if (input.action === "complete") {
                const g = yield* goals.update({
                  sessionID: context.sessionID,
                  status: "completed",
                  verification: input.verification,
                })
                return { goal: g ?? null }
              }
              return { goal: yield* goals.get(context.sessionID) }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to update goal" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
