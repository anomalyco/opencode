import { ConfigWorkflow } from "@/config/workflow"
import { Effect, Schema } from "effect"

export const DEFAULTS = ConfigWorkflow.defaults

export class WorkflowLimitError extends Schema.TaggedErrorClass<WorkflowLimitError>()(
  "WorkflowLimitError",
  {
    limit: Schema.String,
    value: Schema.Number,
    max: Schema.Number,
  },
) {
  override get message() {
    return `Workflow limit exceeded: ${this.limit} = ${this.value} (max: ${this.max})`
  }
}

export * as WorkflowLimits from "./limits"
