export interface ContextAnalystOutput {
  readonly agentId: "context-analyst"
  readonly proposedAction: string
  readonly rationale: string
  readonly confidence: number
}

export interface RiskAnalystOutput {
  readonly agentId: "risk-analyst"
  readonly assessment: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  readonly recommendation: "APPROVE" | "REJECT" | "MODIFY"
  readonly critical: boolean
  readonly reason: string
  readonly recommendationCategory: string
}

export interface PlanningAnalystOutput {
  readonly agentId: "planning-analyst"
  readonly feasible: boolean
  readonly reason: string
}

export type AgentOutput =
  | ContextAnalystOutput
  | RiskAnalystOutput
  | PlanningAnalystOutput

export type ConsensusOutcome =
  | "UNANIMOUS_APPROVED"
  | "DISAGREEMENT_HELD"
  | "VETO_HELD"
  | "NO_PROPOSAL"

export interface ConsensusResult {
  readonly outcome: ConsensusOutcome
  readonly selectedAction?: string
  readonly vetoReason?: string
  readonly conflicts?: string[]
  readonly timestamp: number
}

export type DecisionCategory =
  | "CONFIG_THRESHOLD"
  | "CONFIG_BUDGET"
  | "AGENT_INSTRUCTION"
  | "MODE_OPERATION"
  | "DATA_ARCHITECTURE"
  | "MEMORY_ADDITION"
  | "HELD_REVIEW"

export interface Decision {
  readonly decisionId: string
  readonly category: DecisionCategory
  readonly proposedAction: string
  readonly consensusOutcome: ConsensusOutcome
  readonly rationale: string
  readonly producedAt: number
}

export type ExecutionDisposition =
  | "AUTO_EXECUTED"
  | "HELD_FOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PENDING_APPROVAL"

export interface AuditEntry {
  readonly decisionId: string
  readonly category: DecisionCategory
  readonly outcome: ExecutionDisposition
  readonly executor: "system" | "human"
  readonly timestamp: number
  readonly reason: string
  readonly agentId?: string
  readonly consensusOutcome?: ConsensusOutcome
}

export interface RuleEmbedding {
  readonly id: string
  readonly embedding: number[]
  readonly metadata: {
    readonly ruleId: string
    readonly text: string
    readonly source: string
    readonly createdAt: number
  }
}

export interface ContradictionReport {
  readonly contradictions: ReadonlyArray<{
    readonly ruleA: string
    readonly ruleB: string
    readonly similarity: number
    readonly description: string
  }>
}

export interface VectorStore {
  readonly entries: RuleEmbedding[]
}

export interface QueuedTask<T = unknown> {
  readonly id: string
  readonly task: () => Promise<T>
  readonly enqueuedAt: number
}

export interface WorkerPoolState {
  readonly active: number
  readonly queued: number
  readonly maxWorkers: number
}

export * as P6Types from "./p6-types"
