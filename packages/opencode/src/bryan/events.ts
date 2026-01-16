/**
 * Bryan Integration Event Definitions
 *
 * Type-safe event definitions for Bryan dialectic integration using OpenCode's
 * BusEvent system with Zod schemas.
 */

import z from "zod"
import { BusEvent } from "../bus/bus-event"

export namespace BryanEvents {
  // Question events
  export const QuestionCreated = BusEvent.define(
    "bryan.question.created",
    z.object({
      questionId: z.string(),
      group: z.enum(["philosophical-union", "groundwork-guild", "integration-assembly"]),
      priority: z.enum(["low", "medium", "high", "critical"]),
    })
  )

  export const QuestionAnswered = BusEvent.define(
    "bryan.question.answered",
    z.object({
      questionId: z.string(),
      group: z.enum(["philosophical-union", "groundwork-guild", "integration-assembly"]),
    })
  )

  // Continuation events
  export const ContinuationCreated = BusEvent.define(
    "bryan.continuation.created",
    z.object({
      continuationId: z.string(),
      questionId: z.string(),
      group: z.enum(["philosophical-union", "groundwork-guild", "integration-assembly"]),
    })
  )

  export const ContinuationProcessed = BusEvent.define(
    "bryan.continuation.processed",
    z.object({
      continuationId: z.string(),
      processedBy: z.enum(["inline", "background-agent"]),
    })
  )

  export const ContinuationsSpawned = BusEvent.define(
    "bryan.continuations.spawned",
    z.object({
      taskCount: z.number(),
      totalContinuations: z.number(),
    })
  )
}
