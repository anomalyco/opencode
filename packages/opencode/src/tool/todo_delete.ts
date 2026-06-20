import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./todo_delete.txt"
import { Todo } from "../session/todo"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the todo to delete"),
})

type Metadata = {
  deleted: boolean
  remainingCount: number
}

/** Delete a single todo item by id */
export const TodoDeleteTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todo_delete",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          yield* todo.delete({ sessionID: ctx.sessionID, id: params.id })
          const todos = yield* todo.get(ctx.sessionID)

          return {
            title: `todo_delete: ${params.id}`,
            output: JSON.stringify({ deleted: true, remainingCount: todos.length }, null, 2),
            metadata: {
              deleted: true,
              remainingCount: todos.length,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
