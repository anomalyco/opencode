import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./todo_update.txt"
import { Todo } from "../session/todo"

const parameters = z.object({
  id: z.string().describe("Unique identifier of the todo to update"),
  title: z.string().optional().describe("Short label for the task"),
  description: z.string().optional().describe("Detailed markdown description"),
  content: z.string().optional().describe("Brief description of the task"),
  status: z.string().optional().describe("Status: pending, in_progress, completed, cancelled"),
  priority: z.string().optional().describe("Priority: high, medium, low"),
  due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
  assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
  labels: z.array(z.string()).optional().describe("Tags/labels for categorization"),
})

type Metadata = {
  todo: Todo.Info
}

/** Partially update a single todo item by id */
export const TodoUpdateTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todo_update",
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

          const patch: Partial<Todo.Info> = {}
          if (params.title !== undefined) patch.title = params.title
          if (params.description !== undefined) patch.description = params.description
          if (params.content !== undefined) patch.content = params.content
          if (params.status !== undefined) patch.status = params.status
          if (params.priority !== undefined) patch.priority = params.priority
          if (params.due_date !== undefined) patch.due_date = params.due_date
          if (params.assignee_id !== undefined) patch.assignee_id = params.assignee_id
          if (params.labels !== undefined) patch.labels = params.labels

          const result = yield* todo.update({
            sessionID: ctx.sessionID,
            id: params.id,
            patch,
          })

          return {
            title: `todo_update: ${result.title ?? result.content}`,
            output: JSON.stringify(result, null, 2),
            metadata: {
              todo: result,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
