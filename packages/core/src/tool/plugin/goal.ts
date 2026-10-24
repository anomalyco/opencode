export * as GoalTool from "./goal.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import { Effect, Schema } from "effect"
import { SessionGoal } from "../../session/goal.js"

export const name = "goal"

/**
 * The model's goal surface. `set`, `clear`, and `resume` are deliberately
 * absent: only the user starts, removes, or resumes a goal, so the model cannot
 * construct those requests at all and cannot restart its own loop.
 */
export const Input = Schema.Struct({
  action: Schema.Literals(["edit", "pause"]),
  objective: Schema.optionalKey(Schema.String),
  expectedRevision: Schema.optionalKey(Schema.Number),
})

export const Output = Schema.Struct({
  goal: Schema.optionalKey(SessionGoalSchema.Snapshot),
  todo: Schema.Array(SessionGoalSchema.TodoItem),
  rounds: Schema.Number,
  maxGoalRounds: Schema.Number,
})

export const description = [
  "Read and change the session's goal.",
  "",
  "`edit` rewrites the objective of the current goal; `pause` stops the goal from running further rounds.",
  "The user sets, clears, and resumes a goal, so those actions are not available here. `expectedRevision` is an optional compare-and-set guard.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.goal",
  effect: Effect.fn("GoalTool.Plugin")(function* (ctx: Context) {
    const goal = yield* SessionGoal.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const snapshot = yield* goal.update(context.sessionID, {
                action: input.action,
                objective: input.objective,
                expectedRevision: input.expectedRevision,
                // The model pauses from inside its own turn, where interrupting
                // would cancel the turn that is asking.
                interrupt: false,
              })
              const state = yield* goal.readState(context.sessionID)
              return {
                output: {
                  goal: state.goal,
                  todo: state.todo,
                  rounds: state.rounds,
                  maxGoalRounds: state.maxGoalRounds,
                },
                content: render(snapshot, state),
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

const render = (snapshot: SessionGoalSchema.Snapshot, state: SessionGoalSchema.State) =>
  [
    `Goal ${snapshot.id} is ${snapshot.phase} (revision ${snapshot.revision}).`,
    `Objective: ${snapshot.objective}`,
    `Rounds: ${state.rounds}/${state.maxGoalRounds}.`,
    state.todo.length === 0
      ? "Todo list: (empty; write it with the goal_todo tool)"
      : `Todo list:\n${state.todo.map((item) => `- [${item.position}] ${item.status}: ${item.content}`).join("\n")}`,
  ].join("\n")
