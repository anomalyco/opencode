import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./todo_assign.txt"
import { Todo } from "../session/todo"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the todo to assign"),
  assignee_id: z.string().describe("Assignee user ID to set"),
})

type Metadata = {
  todo: Todo.Info
}

/** Assign a todo item to a user */
export const TodoAssignTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todo_assign",
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

          const result = yield* todo.patchAssignee({
            sessionID: ctx.sessionID,
            id: params.id,
            assigneeId: params.assignee_id,
          })

          return {
            title: `todo_assign: ${result.title ?? result.content}`,
            output: JSON.stringify(result, null, 2),
            metadata: {
              todo: result,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
