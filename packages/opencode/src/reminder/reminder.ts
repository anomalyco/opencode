import z from "zod/v4"
import { Bus } from "../bus"

export namespace Reminder {
  export const Info = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      projectID: z.string(),
      type: z.enum(["one-time", "recurring"]),
      interval: z.number(), // milliseconds
      originalPrompt: z.string().describe("Resolved action to execute with absolute paths and specific identifiers"),
      userDescription: z.string().describe("Human-readable description for identification"),
      time: z.object({
        created: z.number(),
        nextExecution: z.number(),
        lastExecution: z.number().optional(),
      }),
      status: z.enum(["active", "paused", "cancelled"]),
    })
    .meta({ ref: "Reminder" })

  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: Bus.event("reminder.created", z.object({ info: Info })),
    Executed: Bus.event("reminder.executed", z.object({ info: Info })),
    Cancelled: Bus.event("reminder.cancelled", z.object({ info: Info })),
  }
}
