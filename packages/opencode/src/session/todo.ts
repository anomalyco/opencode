import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { SqliteSessionStore } from "./store.sqlite"

const store = SqliteSessionStore

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
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export async function update(input: { sessionID: string; todos: Info[] }) {
    await store.transaction(async (tx) => {
      await tx.todo_replace(
        input.sessionID,
        input.todos.map((todo, position) => ({
          session_id: input.sessionID,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          position,
        })),
      )
    })
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string) {
    const rows = await store.use((tx) => tx.todo_list(sessionID))
    rows.sort((a, b) => a.position - b.position)
    return rows.map((row) => ({
      content: row.content,
      status: row.status,
      priority: row.priority,
    }))
  }
}
