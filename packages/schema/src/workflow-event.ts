export * as WorkflowEvent from "./workflow-event"

import { Schema } from "effect"
import { Event } from "./event"

const Run = {
  id: Schema.String,
  workflow: Schema.String,
  status: Schema.Literals(["running", "completed", "failed", "cancelled", "paused", "interrupted"]),
  current_phase: Schema.NullOr(Schema.String),
  directory: Schema.String,
  agents: Schema.Struct({
    total: Schema.Number,
    running: Schema.Number,
    failed: Schema.Number,
  }),
  pending_question: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
}

export const Updated = Event.define({ type: "workflow.run.updated", schema: Run })
export const Finished = Event.define({ type: "workflow.run.finished", schema: Run })
export const Definitions = Event.inventory(Updated, Finished)
