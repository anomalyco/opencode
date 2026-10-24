export * as GoalTodoTool from "./goal-todo.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import { Effect, Schema } from "effect"
import { SessionGoal } from "../../session/goal.js"

export const name = "goal_todo"

const Acceptance = Schema.String.check(Schema.isMaxLength(200))

/**
 * The model's goal todo surface. `completed` is absent: the verifier owns it, so
 * the model cannot tick its own list. `acceptance` is how the verifier knows
 * what "done" means for an item.
 */
export const Input = Schema.Struct({
  todos: Schema.Array(
    Schema.Struct({
      content: Schema.String,
      status: Schema.Literals(["pending", "in_progress", "cancelled"]),
      acceptance: Schema.optionalKey(Acceptance),
    }),
  ),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionGoalSchema.TodoItem),
  unmet: Schema.Array(
    Schema.Struct({
      position: Schema.Number,
      reason: Schema.String,
    }),
  ),
})

export const description = [
  "Replace the session's whole todo list for the current goal.",
  "",
  "This is the durable goal list, not `todowrite`. The list is stored on the session, and the goal verifier judges every item against its `acceptance` statement; `todowrite` only echoes a working plan back and stores nothing. Use `todowrite` for a working plan outside a goal, and this tool for the list a goal is verified against.",
  "`acceptance` states how the item is judged done; the verifier reads it and nothing else about the item.",
  "The verifier alone marks an item `completed`, so use `pending`, `in_progress` and `cancelled` here.",
  "The result echoes the verifier's unmet items verbatim: fix those before anything else.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.goal-todo",
  effect: Effect.fn("GoalTodoTool.Plugin")(function* (ctx: Context) {
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
              // The verifier's reasons live on the rows this call replaces, so read
              // them first: the echo below is where the model sees them.
              const before = yield* goal.readTodo(context.sessionID)
              const unmet = before.flatMap((item) =>
                item.feedback === undefined || item.feedback === ""
                  ? []
                  : [{ position: item.position, reason: item.feedback }],
              )
              yield* goal.replaceTodo(context.sessionID, input.todos)
              const after = yield* goal.readTodo(context.sessionID)
              return { output: { todos: after, unmet }, content: render(after, unmet) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

const render = (
  todos: ReadonlyArray<SessionGoalSchema.TodoItem>,
  unmet: ReadonlyArray<{ readonly position: number; readonly reason: string }>,
) =>
  [
    todos.length === 0
      ? "Todo list: (empty)"
      : `Todo list:\n${todos
          .map(
            (item) =>
              `- [${item.position}] ${item.status}: ${item.content}${item.acceptance === undefined ? "" : `\n  acceptance: ${item.acceptance}`}`,
          )
          .join("\n")}`,
    unmet.length === 0
      ? "The verifier has not rejected anything."
      : `The verifier did not accept these items:\n${unmet.map((item) => `- [${item.position}] ${item.reason}`).join("\n")}`,
  ].join("\n\n")
