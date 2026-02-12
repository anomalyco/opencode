import z from "zod"
import { Identifier } from "../id/id"

export namespace AutonomousTypes {
  export const Config = z.object({
    maxTurns: z.number().int().positive().default(5),
    playerModel: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    coachModel: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    playerTimeout: z.number().int().positive().default(300000), // 5 minutes
    coachTimeout: z.number().int().positive().default(180000), // 3 minutes
  })
  export type Config = z.infer<typeof Config>

  export const TurnMetrics = z.object({
    turn: z.number().int().positive(),
    playerTokens: z.number().int().nonnegative(),
    coachTokens: z.number().int().nonnegative(),
    playerDuration: z.number().nonnegative(),
    coachDuration: z.number().nonnegative(),
    feedbackLength: z.number().int().nonnegative(),
  })
  export type TurnMetrics = z.infer<typeof TurnMetrics>

  export const CoachResult = z.object({
    approved: z.boolean(),
    feedback: z.string(),
  })
  export type CoachResult = z.infer<typeof CoachResult>

  export const RunResult = z.object({
    success: z.boolean(),
    turns: z.number().int().nonnegative(),
    metrics: TurnMetrics.array(),
    sessionID: Identifier.schema("session"),
    coachSessionID: Identifier.schema("session").optional(),
  })
  export type RunResult = z.infer<typeof RunResult>

  export const APPROVAL_SIGNAL = "IMPLEMENTATION_APPROVED"
}
