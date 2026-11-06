export * as GoalPlugin from "./goal.js"

import { ToolFailure } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Service } from "../session/goal.js"
import { SessionGoal } from "@opencode/schema/session-goal"

export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn(function* (ctx) {
    const goals = yield* Service
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "create_goal",
          description: "Set a goal for this session and continue working toward it.",
          input: Schema.Struct({ objective: SessionGoal.Info.fields.objective }),
          output: Schema.Struct({ status: Schema.Literal("active") }),
          options: { codemode: false },
          execute: (input, context) =>
            Effect.gen(function* () {
              if (yield* goals.get(context.sessionID))
                return yield* new ToolFailure({ message: "A goal already exists. Use update_goal to edit it." })
              yield* goals
                .set(context.sessionID, input.objective)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              return { output: { status: "active" as const }, content: "Goal set." }
            }),
        })
        editor.add({
          name: "get_goal",
          description: "Get the current goal, status, and continuation counters.",
          input: Schema.Struct({}),
          output: SessionGoal.Monitor,
          options: { codemode: false },
          execute: (_input, context) =>
            goals
              .inspect(context.sessionID)
              .pipe(Effect.map((output) => ({ output, content: JSON.stringify(output) }))),
        })
        editor.add({
          name: "update_goal",
          description:
            "Edit the goal or change its status. Mark complete after verification. Use blocked with a reason when progress requires user input or an external change. When waiting for user approval, set awaitingApproval=true with a reason; three automatic continuations in that state block the goal. Set awaitingApproval=false when approval arrives or work can proceed.",
          input: SessionGoal.Update,
          output: SessionGoal.Monitor,
          options: { codemode: false },
          execute: (input, context) =>
            goals.update(context.sessionID, input).pipe(
              Effect.andThen(goals.inspect(context.sessionID)),
              Effect.map((output) => ({ output, content: JSON.stringify(output) })),
              Effect.mapError((error) => new ToolFailure({ message: error.message, error })),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
})
