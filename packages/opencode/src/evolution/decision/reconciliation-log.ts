import { Schema } from "effect"
import type { ReasoningStrength } from "@/evolution/decision/proposal-candidate"
import type { AgentCapability } from "@/evolution/decision/agents/types"

// RC-G3-01: Four outcomes — NO_CANDIDATES (system error), BELOW_THRESHOLD (valid business),
// PROPOSAL_SUBMITTED, HELD_FOR_REVIEW (ADR-026 — human-in-the-loop).
export type ReconciliationReason = "HIGHEST_CONFIDENCE" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"
export type ReconciliationOutcome = "PROPOSAL_SUBMITTED" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"

export interface CandidateSummary {
  readonly agentId: string
  readonly reasoningStrength: ReasoningStrength
  readonly confidenceScore: number
  readonly selected: boolean
  readonly rejectionReason?: string
}

// G4: ParticipantEntry for multi-agent audit trail
export interface ParticipantEntry {
  readonly agentId: string
  readonly capabilities: AgentCapability[]
  readonly contributionType: string
  readonly confidenceScore: number
  readonly selected: boolean
}

// AC-18: ReconciliationLog = audit metadata only.
// No full rationale, full prompt, or full context.
export interface ReconciliationLog {
  readonly sessionId: string
  readonly contextHash: string
  readonly candidates: readonly CandidateSummary[]
  // G4: participants tracks ALL agents (generators + advisors)
  readonly participants: readonly ParticipantEntry[]
  readonly selectedCandidateAgentId: string | null
  readonly selectionReason: ReconciliationReason
  readonly outcome: ReconciliationOutcome
  // AC-17: proposalId populated AFTER successful submission.
  // submissionStatus documents the persistence phase:
  //   - after FIRST persist (pre-submit): submissionStatus = "PENDING", proposalId absent
  //   - after successful submission + update: submissionStatus = "SUBMITTED", proposalId set
  readonly submissionStatus?: "PENDING" | "SUBMITTED"
  readonly proposalId?: string
  readonly diversityMetrics?: {
    readonly edi: number
    readonly falseConsensusWarning: boolean
  }
  readonly createdAt: number
}

// Full schema for persistence (Brain). Schema.Literal for each string union.
export const RECONCILIATION_REASON = Schema.Union([Schema.Literal("HIGHEST_CONFIDENCE"), Schema.Literal("BELOW_THRESHOLD"), Schema.Literal("NO_CANDIDATES"), Schema.Literal("HELD_FOR_REVIEW")])
export const RECONCILIATION_OUTCOME = Schema.Union([Schema.Literal("PROPOSAL_SUBMITTED"), Schema.Literal("BELOW_THRESHOLD"), Schema.Literal("NO_CANDIDATES"), Schema.Literal("HELD_FOR_REVIEW")])

export const CandidateSummarySchema = Schema.Struct({
  agentId: Schema.String,
  reasoningStrength: Schema.Union([Schema.Literal("low"), Schema.Literal("medium"), Schema.Literal("high")]),
  confidenceScore: Schema.Number,
  selected: Schema.Boolean,
  rejectionReason: Schema.optional(Schema.String),
})

const AgentCapabilitySchema = Schema.Union([Schema.Literal("proposal"), Schema.Literal("risk-analysis"), Schema.Literal("execution-plan")])

export const ParticipantEntrySchema = Schema.Struct({
  agentId: Schema.String,
  capabilities: Schema.Array(AgentCapabilitySchema),
  contributionType: Schema.String,
  confidenceScore: Schema.Number,
  selected: Schema.Boolean,
})

export const ReconciliationLogSchema = Schema.Struct({
  sessionId: Schema.String,
  contextHash: Schema.String,
  candidates: Schema.Array(CandidateSummarySchema),
  participants: Schema.Array(ParticipantEntrySchema),
  selectedCandidateAgentId: Schema.Union([Schema.Null, Schema.String]),
  selectionReason: RECONCILIATION_REASON,
  outcome: RECONCILIATION_OUTCOME,
  submissionStatus: Schema.optional(Schema.Union([Schema.Literal("PENDING"), Schema.Literal("SUBMITTED")])),
  proposalId: Schema.optional(Schema.String),
  diversityMetrics: Schema.optional(Schema.Struct({
    edi: Schema.Number,
    falseConsensusWarning: Schema.Boolean,
  })),
  createdAt: Schema.Number,
})

// G3-AR3-A: ReconciliationResult DTO — strategy returns domain result, not audit document.
// Engine constructs the ReconciliationLog from this result.
export interface ReconciliationResult {
  readonly outcome: ReconciliationOutcome
  readonly selectedCandidate: import("@/evolution/decision/proposal-candidate").ProposalCandidate | null
  readonly selectedCandidateAgentId: string | null
  readonly selectionReason: ReconciliationReason
  readonly candidates: readonly CandidateSummary[]
}

// ADR-017: Abstract interface to prevent God DecisionEngine.
// G1–G3 scope: only CONFIDENCE strategy.
// F-04 (ADR-026): AdvisorContext added for HELD_FOR_REVIEW detection
export interface AdvisorContext {
  readonly riskAssessment?: {
    readonly overallSeverity: "low" | "medium" | "high" | "critical"
    readonly recommendationCategory: "APPROVE" | "REJECT" | "MODIFY"
    readonly rationale: string
    readonly risks: readonly { description: string; severity: string; category: string }[]
  }
}

export interface ReconciliationStrategy {
  readonly name: string
  readonly reconcile: (
    candidates: readonly import("@/evolution/decision/proposal-candidate").ProposalCandidate[],
    config: { minCandidateConfidence: number },
    advisorContext?: AdvisorContext,
  ) => ReconciliationResult
}

export * as EvolutionReconciliationLog from "./reconciliation-log"
