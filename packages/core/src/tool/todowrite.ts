export * as TodoWriteTool from "./todowrite"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionTodo } from "../session/todo"
import { Database } from "../database/database"
import { harness_task } from "../harness/schema"
import { eq } from "drizzle-orm"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.todos, null, 2)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const permission = yield* PermissionV2.Service
    const { db } = yield* Database.Service

    yield* tools
      .register({
        [name]: Tool.make({
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

              const allCompleted = input.todos.length > 0 && input.todos.every((t) => t.status === "completed")
              if (allCompleted) {
                yield* db
                  .update(harness_task)
                  .set({ task_sub_status: "todos_completed" })
                  .where(eq(harness_task.session_id, context.sessionID))
                  .run()
                  .pipe(Effect.orElseSucceed(() => undefined))
              }

              return { todos: input.todos }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to update todos" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/todowrite",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, SessionTodo.node, Database.node],
})

