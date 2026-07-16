export * as ConfigWorkflowV1 from "./workflow"

import { Schema } from "effect"

const StepOutput = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
})

const WorkflowStep = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  depends_on: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])),
  when: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  outputs: Schema.optional(Schema.mutable(Schema.Array(StepOutput))),
})

export const Info = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  steps: Schema.mutable(Schema.Array(WorkflowStep)),
})
export type Info = Schema.Schema.Type<typeof Info>

export type Step = Schema.Schema.Type<typeof WorkflowStep>
export type StepOutput = Schema.Schema.Type<typeof StepOutput>
