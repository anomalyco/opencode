import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Storage } from "../storage/storage"

export namespace Todo {
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      id: z.string().describe("Unique identifier for the todo item"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const State = z
    .object({
      paused: z.boolean().default(false),
      pausedAt: z.number().optional(),
      updatedAt: z.number().optional(),
      lastUpdatedMessageID: z.string().optional(),
    })
    .meta({ ref: "TodoState" })
  export type State = z.infer<typeof State>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export async function update(input: { sessionID: string; todos: Info[]; messageID?: string }) {
    await Storage.write(["todo", input.sessionID], input.todos)
    await updateState(input.sessionID, {
      paused: false,
      updatedAt: Date.now(),
      lastUpdatedMessageID: input.messageID,
    })
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string) {
    return Storage.read<Info[]>(["todo", sessionID])
      .then((x) => x || [])
      .catch(() => [])
  }

  export async function getState(sessionID: string) {
    return Storage.read<State>(["todo_state", sessionID])
      .then((x) => x || { paused: false })
      .catch(() => ({ paused: false }))
  }

  export async function updateState(sessionID: string, patch: Partial<State>) {
    const current = await getState(sessionID)
    const next: State = {
      paused: patch.paused ?? current.paused ?? false,
      pausedAt: patch.pausedAt ?? current.pausedAt,
      updatedAt: patch.updatedAt ?? current.updatedAt,
      lastUpdatedMessageID: patch.lastUpdatedMessageID ?? current.lastUpdatedMessageID,
    }
    await Storage.write(["todo_state", sessionID], next)
    return next
  }
}
