import { Effect, Clock, Schema } from "effect"
import { LLM, Model, LLMError } from "@opencode-ai/llm"
import type { Model as LLMModel } from "@opencode-ai/llm"
import type { EvolutionContext } from "@/evolution/context"
import { formatEvolutionContext } from "@/evolution/context"
import type { AgentCriteria } from "@/evolution/decision/agents/types"
import { ROUTE_EVOLUTION } from "./route"

export const RISK_ASSESSMENT_SCHEMA = Schema.Struct({
  risks: Schema.Array(Schema.Struct({
    description: Schema.String,
    severity: Schema.Literals(["low", "medium", "high"]),
    category: Schema.Literals(["technical", "operational", "architectural", "rollout"]),
  })),
  overallSeverity: Schema.Literals(["low", "medium", "high", "critical"]),
  recommendationCategory: Schema.Literals(["APPROVE", "REJECT", "MODIFY"]),
  rationale: Schema.String,
})

export interface RiskItem {
  readonly description: string
  readonly severity: "low" | "medium" | "high"
  readonly category: string
}

export interface RiskAssessment {
  readonly risks: readonly RiskItem[]
  readonly overallSeverity: "low" | "medium" | "high" | "critical"
  readonly recommendationCategory: "APPROVE" | "REJECT" | "MODIFY"
  readonly rationale: string
}

export type RiskOutput = Schema.Schema.Type<typeof RISK_ASSESSMENT_SCHEMA>

export const execute = (
  context: EvolutionContext,
  criteria: AgentCriteria,
  model?: LLMModel,
): Effect.Effect<RiskAssessment, LLMError> => {
  const system = `Risk Analyst: ${criteria.instruction}\n\n${formatEvolutionContext(context)}`
  const m = model ?? Model.make({ id: "risk-agent", provider: "evolution", route: ROUTE_EVOLUTION })
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const generated = yield* LLM.generateObject({
      schema: RISK_ASSESSMENT_SCHEMA,
      model: m,
      system,
      prompt: `Analyze risks for: ${criteria.tags.join(", ")}. Provide overallSeverity ("low","medium","high","critical") and recommendationCategory ("APPROVE","REJECT","MODIFY"). "critical" severity with "REJECT" recommendation pauses the proposal for human review.`,
      generation: { temperature: 0.1 },
    })
    const output = generated.object as RiskOutput
    return {
      risks: output.risks.map((r: any) => ({
        description: r.description,
        severity: r.severity,
        category: r.category,
      })),
      overallSeverity: output.overallSeverity,
      recommendationCategory: output.recommendationCategory,
      rationale: output.rationale,
    }
  })
}

export * as EvolutionRiskAgent from "./risk"
