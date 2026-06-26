import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

export const Info = Schema.Struct({
  disable: Schema.optional(Schema.Boolean).annotate({
    description: "Disable the workflow tool entirely",
  }),
  max_concurrency: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of concurrent workflow workers (default: 8)",
  }),
  max_agents: Schema.optional(PositiveInt).annotate({
    description: "Maximum number of agents per workflow run (default: 100)",
  }),
  timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Workflow execution timeout in milliseconds (default: 1800000 = 30 min)",
  }),
})

export type Info = Schema.Schema.Type<typeof Info>

export const defaults = {
  max_concurrency: 8,
  max_agents: 100,
  timeout_ms: 30 * 60 * 1000,
}

export * as ConfigWorkflow from "./workflow"
