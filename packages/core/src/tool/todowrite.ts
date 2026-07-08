export * as TodoWriteTool from "./todowrite"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTodo } from "../session/todo"
import { Tool } from "./tool"

export const name = "todowrite"

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.todos, null, 2)

export const Plugin = {
  id: "opencode.tool.todowrite",
  effect: Effect.fn("TodoWriteTool.Plugin")(function* (ctx: PluginContext) {
    const todos = yield* SessionTodo.Service
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description:
              "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: ["*"],
                  save: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                yield* todos.update({ sessionID: context.sessionID, todos: input.todos })
                return { todos: input.todos }
              }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to update todos", error }))),
          }),
        ),
      )
      .pipe(Effect.orDie)
  }),
}
