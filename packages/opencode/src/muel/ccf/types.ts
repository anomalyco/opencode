/**
 * CCF Types — Counterfactual Consistency Field
 * Formal interfaces for multi-world validation.
 */

export interface WorldModel {
  readonly id: string
  readonly domain: string
  simulate(output: string, context?: unknown): ModelPrediction
}

export interface ModelPrediction {
  modelId: string
  valid: boolean
  confidence: number
  stateHash: string
  reasoning: string
  anomalies: string[]
}

export interface ConsistencyResult {
  overallConsistency: number
  valid: boolean
  modelAgreements: Record<string, { agrees: boolean; confidence: number; reasoning: string }>
  divergentBranches: string[]
  consensusDirection: "VALID" | "INVALID" | "AMBIGUOUS"
  formalValidity: number
}

export interface CCFEvaluation {
  output: string
  predictions: ModelPrediction[]
  consistency: ConsistencyResult
  verdict: "ACCEPTED" | "REJECTED"
  reason: string
  timestamp: number
}
