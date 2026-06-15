import { EventV2 } from "@opencode-ai/core/event"
import { Schema } from "effect"

const Base = { timestamp: Schema.Number }

export const PhaseStarted = EventV2.define({
  type: "session.loop.phase.started",
  schema: {
    ...Base,
    sessionID: Schema.String,
    phaseId: Schema.String,
    phaseTitle: Schema.String,
    totalPhases: Schema.Int,
  },
})

export const PhaseCompleted = EventV2.define({
  type: "session.loop.phase.completed",
  schema: {
    ...Base,
    sessionID: Schema.String,
    phaseId: Schema.String,
    status: Schema.Literals(["completed", "failed"]),
    attempts: Schema.Int,
  },
})

export const LoopCompleted = EventV2.define({
  type: "session.loop.completed",
  schema: {
    ...Base,
    sessionID: Schema.String,
    status: Schema.Literals(["success", "partial", "blocked"]),
    totalPhases: Schema.Int,
    completedPhases: Schema.Int,
    failedPhases: Schema.Int,
    elapsedMs: Schema.Int,
  },
})

export const StuckDetected = EventV2.define({
  type: "session.loop.stuck.detected",
  schema: {
    ...Base,
    sessionID: Schema.String,
    phaseId: Schema.String,
    tool: Schema.String,
    iterations: Schema.Int,
  },
})
