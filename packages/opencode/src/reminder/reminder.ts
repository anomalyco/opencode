import z from "zod/v4"

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
}
