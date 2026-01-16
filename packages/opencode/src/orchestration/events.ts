/**
 * Orchestration Event Definitions
 *
 * Type-safe event definitions for orchestration features using OpenCode's
 * BusEvent system with Zod schemas.
 */

import z from "zod"
import { BusEvent } from "../bus/bus-event"

export namespace OrchestrationEvents {
  // Ralph Loop events
  export const RalphLoopStarted = BusEvent.define(
    "orchestration.ralph_loop.started",
    z.object({
      maxIterations: z.number(),
      sessionId: z.string(),
    })
  )

  export const RalphLoopIteration = BusEvent.define(
    "orchestration.ralph_loop.iteration",
    z.object({
      iteration: z.number(),
      maxIterations: z.number(),
    })
  )

  export const RalphLoopStopped = BusEvent.define(
    "orchestration.ralph_loop.stopped",
    z.object({
      reason: z.string(),
      iterationsCompleted: z.number(),
    })
  )

  // Background agent events
  export const BackgroundAgentSpawned = BusEvent.define(
    "orchestration.background_agent.spawned",
    z.object({
      taskId: z.string(),
      agentType: z.string(),
      model: z.string(),
      description: z.string(),
    })
  )

  export const BackgroundAgentCompleted = BusEvent.define(
    "orchestration.background_agent.completed",
    z.object({
      taskId: z.string(),
      agentType: z.string(),
      outputLength: z.number().optional(),
    })
  )

  export const BackgroundAgentFailed = BusEvent.define(
    "orchestration.background_agent.failed",
    z.object({
      taskId: z.string(),
      agentType: z.string(),
      error: z.string(),
    })
  )

  // Complexity detection events
  export const ComplexityDetected = BusEvent.define(
    "orchestration.complexity.detected",
    z.object({
      level: z.enum(["simple", "moderate", "complex", "research"]),
      score: z.number(),
      signalCount: z.number(),
    })
  )
}
