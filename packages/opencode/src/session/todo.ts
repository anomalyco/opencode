import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      id: z.string().optional().describe("Unique identifier for the todo item"),
      parent_id: z.string().nullable().optional().describe("Parent todo ID for hierarchy; null for root-level items"),
      level: z.number().int().min(0).default(0).describe("Hierarchy depth: 0=root, 1=child, 2=grandchild"),
      title: z.string().optional().describe("Short label for the task; falls back to content if not set"),
      content: z.string().describe("Brief description of the task"),
      description: z.string().default("").describe("Detailed markdown description with @file and /skill references"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      labels: z.array(z.string()).default([]).describe("Tags/labels for categorization"),
      due_date: z.string().nullable().optional().describe("Due date in ISO 8601 format"),
      team_id: z.string().nullable().optional().describe("Team ID for issue sync"),
      project_id: z.string().nullable().optional().describe("Project ID for issue sync"),
      assignee_id: z.string().nullable().optional().describe("Assignee user ID for issue sync"),
      linear_issue_id: z.string().nullable().optional().describe("Linear issue ID for bidirectional sync"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    ),
  }

  export interface Interface {
    readonly update: (input: { sessionID: SessionID; todos: Info[] }) => Effect.Effect<void>
    readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
        yield* Effect.sync(() =>
          Database.transaction((db) => {
            db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
            db.insert(TodoTable)
              .values(
                input.todos.map((todo, index) => ({
                  session_id: input.sessionID,
                  id: todo.id ?? crypto.randomUUID(),
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  position: index,
                  parent_id: todo.parent_id ?? null,
                  level: todo.level,
                  title: todo.title ?? todo.content,
                  description: todo.description,
                  labels: JSON.stringify(todo.labels),
                  due_date: todo.due_date ?? null,
                  team_id: todo.team_id ?? null,
                  project_id: todo.project_id ?? null,
                  assignee_id: todo.assignee_id ?? null,
                  linear_issue_id: todo.linear_issue_id ?? null,
                })),
              )
              .run()
          }),
        )
        yield* bus.publish(Event.Updated, input)
      })

      const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, sessionID))
              .orderBy(asc(TodoTable.position))
              .all(),
          ),
        )
        return rows.map((row) => ({
          id: row.id,
          parent_id: row.parent_id,
          level: row.level,
          title: row.title,
          content: row.content,
          description: row.description,
          status: row.status,
          priority: row.priority,
          labels: JSON.parse(row.labels) as string[],
          due_date: row.due_date,
          team_id: row.team_id,
          project_id: row.project_id,
          assignee_id: row.assignee_id,
          linear_issue_id: row.linear_issue_id,
        }))
      })

      return Service.of({ update, get })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
}
