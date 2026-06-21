import type { ConsensusOutcome, DecisionCategory } from "@/evolution/decision/p6-types"
import type { ReconciliationLog } from "@/evolution/decision/reconciliation-log"

export interface OutputParticipant {
  readonly agentId: string
  readonly contributionType: string
  readonly executed: boolean
  readonly selected: boolean
}

export interface OutputEnrichment {
  readonly agentId: string
  readonly summary: string
}

// G4: ReconcileOutput — boundary type between engine and pipeline.
// Engine produces it (raw data), activation consumes it (routes through pipeline).
// No side-effect fields (proposalId, submissionResult, logId) — those belong to activation.
export interface ReconcileOutput {
  readonly outcome: "PROPOSAL_SUBMITTED" | "BELOW_THRESHOLD" | "NO_CANDIDATES" | "HELD_FOR_REVIEW"
  readonly consensusOutcome: ConsensusOutcome
  readonly proposedAction?: string
  readonly rationale?: string
  readonly tags?: readonly string[]
  readonly selectedAgentId?: string
  readonly vetoReason?: string
  readonly conflicts?: string[]
  readonly decisionCategory?: DecisionCategory
  readonly participants?: readonly OutputParticipant[]
  readonly enrichments?: readonly OutputEnrichment[]
  readonly diversityMetrics?: { readonly edi: number; readonly falseConsensusWarning: boolean }
  readonly reconciliationLog?: ReconciliationLog
}

// No self-reexport — types are imported directly by name from this file
