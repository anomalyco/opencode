export * as TodoWriteTool from "./todowrite"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "../tool-registry"

export const name = "todowrite"

export const Parameters = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({ description: "The updated todo list" }),
})

export const Success = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Success = typeof Success.Type

export const toModelOutput = (output: Success) => JSON.stringify(output.todos, null, 2)

const definition = Tool.make({
  description:
    "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current.",
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const todos = yield* SessionTodo.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, assertPermission }) =>
          Effect.gen(function* () {
            yield* assertPermission({ action: name, resources: ["*"], save: ["*"] })
            yield* todos.update({ sessionID, todos: parameters.todos })
            return { todos: parameters.todos }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new ToolFailure({ message: "Unable to update todos", error: Cause.squash(cause) })),
            ),
          ),
      }),
    )
  }),
)
