import { Workflow } from "@opencode-ai/core/workflow"
import { Effect, Layer } from "effect"

export function layer(overrides: Partial<Workflow.Interface> = {}) {
  return Layer.succeed(
    Workflow.Service,
    Workflow.Service.of({
      heavy: () => Effect.die("Unexpected Heavy workflow execution"),
      council: () => Effect.die("Unexpected Council workflow execution"),
      research: () => Effect.die("Unexpected Research workflow execution"),
      studio: () => Effect.die("Unexpected Studio workflow execution"),
      ...overrides,
    }),
  )
}

export * as TestWorkflow from "./workflow"
