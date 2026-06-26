import { Schema } from "effect"

export const SpawnEvent = Schema.Struct({
  type: Schema.Literal("Workflow.Spawn"),
  workerIndex: Schema.Number,
  agent: Schema.String,
  prompt: Schema.String,
})
export type SpawnEvent = Schema.Schema.Type<typeof SpawnEvent>

export const CompleteEvent = Schema.Struct({
  type: Schema.Literal("Workflow.Complete"),
  workerIndex: Schema.Number,
  sessionID: Schema.String,
  ok: Schema.Boolean,
})
export type CompleteEvent = Schema.Schema.Type<typeof CompleteEvent>

export const FailEvent = Schema.Struct({
  type: Schema.Literal("Workflow.Fail"),
  workerIndex: Schema.Number,
  error: Schema.String,
})
export type FailEvent = Schema.Schema.Type<typeof FailEvent>

export const ProgressEvent = Schema.Struct({
  type: Schema.Literal("Workflow.Progress"),
  completed: Schema.Number,
  total: Schema.Number,
  active: Schema.Number,
})
export type ProgressEvent = Schema.Schema.Type<typeof ProgressEvent>

export type WorkflowEvent = SpawnEvent | CompleteEvent | FailEvent | ProgressEvent

export * as WorkflowEvents from "./events"
