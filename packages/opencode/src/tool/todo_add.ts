import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./todo_add.txt"
import { Todo } from "../session/todo"

const parameters = z.object({
  title: z.string().describe("Short label for the task; falls back to content if not set"),
  description: z.string().optional().describe("Detailed markdown description"),
  content: z.string().optional().describe("Brief description of the task; defaults to title"),
  status: z.string().optional().describe("Status: pending, in_progress, completed, cancelled"),
  priority: z.string().optional().describe("Priority: high, medium, low"),
  parent_id: z.string().nullable().optional().describe("Parent todo ID for hierarchy"),
  level: z.number().int().min(0).optional().describe("Hierarchy depth: 0=root, 1=child, 2=grandchild"),
  due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
  assignee_id: z.string().nullable().optional().describe("Assignee user ID"),
  labels: z.array(z.string()).optional().describe("Tags/labels for categorization"),
})

type Metadata = {
  todo: Todo.Info
}

/** Create a single todo item and append it to the session's todo list */
export const TodoAddTool = Tool.define<typeof parameters, Metadata, Todo.Service>(
  "todo_add",
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

          const result = yield* todo.create({
            sessionID: ctx.sessionID,
            todo: {
              content: params.content ?? params.title,
              title: params.title,
              description: params.description ?? "",
              status: params.status ?? "pending",
              priority: params.priority ?? "medium",
              parent_id: params.parent_id ?? null,
              level: params.level ?? 0,
              due_date: params.due_date ?? null,
              assignee_id: params.assignee_id ?? null,
              labels: params.labels ?? [],
            },
          })

          return {
            title: `todo_add: ${params.title}`,
            output: JSON.stringify(result, null, 2),
            metadata: {
              todo: result,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof parameters, Metadata>
  }),
)
