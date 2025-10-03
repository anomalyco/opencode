import z from "zod/v4"

export const TelemetryEventSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  callID: z.string().optional(),
  status: z.enum(["success", "error"]),
  duration: z.number(),
  timestamp: z.number(),
  extra: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
})

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>
