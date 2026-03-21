import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { Database, eq, asc } from "../storage/db"
import { TodoTable } from "./session.sql"

export namespace Todo {
  export const Info = z
    .object({
      id: z.string().optional().describe("Unique identifier for the todo item (generated if not provided)"),
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled, skipped"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      parentId: z.string().optional().describe("Parent todo ID for hierarchical decomposition"),
      dependsOn: z.array(z.string()).optional().describe("List of todo IDs that must be completed before this one"),
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

  export function update(input: { sessionID: SessionID; todos: Info[] }) {
    Database.transaction((db) => {
      db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
      if (input.todos.length === 0) return
      db.insert(TodoTable)
        .values(
          input.todos.map((todo, position) => ({
            id: todo.id || crypto.randomUUID(),
            session_id: input.sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            parent_id: todo.parentId,
            depends_on: todo.dependsOn,
            position,
          })),
        )
        .run()
    })
    Bus.publish(Event.Updated, input)
  }

  export function get(sessionID: SessionID) {
    const rows = Database.use((db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)).all(),
    )
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id,
      dependsOn: row.depends_on,
    }))
  }
}
