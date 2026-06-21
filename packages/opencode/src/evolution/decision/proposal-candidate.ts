import { Schema } from "effect"

export type ReasoningStrength = "low" | "medium" | "high"

// ADR-017: ordinal confidence model — agent LLM output only ordinal
export const AGENT_OUTPUT_SCHEMA = Schema.Struct({
  reasoningStrength: Schema.Literals(["low", "medium", "high"]),
  rationale: Schema.String,
  proposedAction: Schema.String,
  tags: Schema.Array(Schema.String),
})

export const SCORING_CONTRACT: Record<ReasoningStrength, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.85,
}

export function mapConfidence(strength: ReasoningStrength): number {
  return SCORING_CONTRACT[strength]
}

export interface ProposalCandidate {
  readonly agentId: string
  readonly reasoningStrength: ReasoningStrength
  readonly rationale: string
  readonly proposedAction: string
  readonly tags: readonly string[]
  readonly producedAt: number
}

export type AgentOutput = Schema.Schema.Type<typeof AGENT_OUTPUT_SCHEMA>

export * as EvolutionProposalCandidate from "./proposal-candidate"
