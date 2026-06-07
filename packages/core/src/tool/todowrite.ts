export * as TodoWriteTool from "./todowrite"

import { ToolFailure, toolText } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTodo } from "../session/todo"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Parameters = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({ description: "The updated todo list" }),
})

export const Success = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Success = typeof Success.Type

export const toModelOutput = (output: Success) => JSON.stringify(output.todos, null, 2)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current.",
          input: Parameters,
          output: Success,
          toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
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
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to update todos" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
