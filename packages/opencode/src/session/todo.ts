import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { Database } from "../storage/db.pg"
import { eq, asc } from "drizzle-orm"
import { TodoTable } from "@/storage/schema"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
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

  export async function update(input: { sessionID: SessionID; todos: Info[] }) {
    await Database.use(async (db) => {
      await db.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID))
      if (input.todos.length === 0) return
      await db.insert(TodoTable).values(
        input.todos.map((todo, position) => ({
          session_id: input.sessionID,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          position,
          time_created: Date.now(),
          time_updated: Date.now(),
        })),
      )
    })
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: SessionID) {
    const rows = await Database.use(async (db) =>
      db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).orderBy(asc(TodoTable.position)),
    )
    return rows.map((row) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
  }
}
