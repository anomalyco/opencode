import z from "zod"
import { Bus } from "../bus"
import { Storage } from "../storage/storage"

export namespace Plan {
  export const Entry = z
    .object({
      content: z.string().describe("Human-readable description of the task"),
      priority: z.enum(["high", "medium", "low"]).describe("Relative importance of the task"),
      status: z.enum(["pending", "in_progress", "completed"]).describe("Execution status of the task"),
    })
    .meta({ ref: "PlanEntry" })
  export type Entry = z.infer<typeof Entry>

  export const Event = {
    Updated: Bus.event(
      "plan.updated",
      z.object({
        sessionID: z.string(),
        entries: z.array(Entry),
      }),
    ),
  }

  export async function update(input: { sessionID: string; entries: Entry[] }) {
    await Storage.write(["plan", input.sessionID], input.entries)
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string) {
    return Storage.read<Entry[]>(["plan", sessionID])
      .then((x) => x || [])
      .catch(() => [])
  }
}
