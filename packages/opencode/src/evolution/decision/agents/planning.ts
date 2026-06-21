import { Effect, Clock, Schema } from "effect"
import { LLM, Model, LLMError } from "@opencode-ai/llm"
import type { Model as LLMModel } from "@opencode-ai/llm"
import type { EvolutionContext } from "@/evolution/context"
import { formatEvolutionContext } from "@/evolution/context"
import type { AgentCriteria } from "@/evolution/decision/agents/types"
import { ROUTE_EVOLUTION } from "./route"

export const EXECUTION_PLAN_SCHEMA = Schema.Struct({
  phases: Schema.Array(Schema.Struct({
    name: Schema.String,
    steps: Schema.Array(Schema.String),
    estimatedEffort: Schema.String,
  })),
  estimatedComplexity: Schema.Number,
  rationale: Schema.String,
})

export interface PlanStep {
  readonly name: string
  readonly steps: readonly string[]
  readonly estimatedEffort: string
}

export interface ExecutionPlan {
  readonly phases: readonly PlanStep[]
  readonly estimatedComplexity: number
  readonly rationale: string
}

export type PlanOutput = Schema.Schema.Type<typeof EXECUTION_PLAN_SCHEMA>

export const execute = (
  context: EvolutionContext,
  criteria: AgentCriteria,
  model?: LLMModel,
): Effect.Effect<ExecutionPlan, LLMError> => {
  const system = `Planning Analyst: ${criteria.instruction}\n\n${formatEvolutionContext(context)}`
  const m = model ?? Model.make({ id: "planning-agent", provider: "evolution", route: ROUTE_EVOLUTION })
  return Effect.gen(function* () {
    const generated = yield* LLM.generateObject({
      schema: EXECUTION_PLAN_SCHEMA,
      model: m,
      system,
      prompt: `Create execution plan for: ${criteria.tags.join(", ")}`,
      generation: { temperature: 0.1 },
    })
    const output = generated.object as PlanOutput
    return {
      phases: output.phases.map((p: any) => ({
        name: p.name,
        steps: p.steps,
        estimatedEffort: p.estimatedEffort,
      })),
      estimatedComplexity: output.estimatedComplexity,
      rationale: output.rationale,
    }
  })
}

export * as EvolutionPlanningAgent from "./planning"
