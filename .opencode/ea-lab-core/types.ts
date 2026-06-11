export const EvidenceTypes = [
  "message",
  "commit",
  "file",
  "backtest_report",
  "mt5_log",
  "url",
  "command",
  "context7_doc",
  "manual_note",
] as const

export const ExperimentStatuses = ["draft", "running", "passed", "failed", "rejected", "promoted"] as const
export const ExperimentStages = ["research", "backtest", "out_of_sample", "demo_forward", "micro_live", "limited_live"] as const
export const OverfitRisks = ["low", "medium", "high", "unknown"] as const
export const ExperienceTypes = ["success", "failure", "near_miss", "rejected", "risk"] as const
export const ConfidenceLevels = ["low", "medium", "high"] as const
export const MemoryStatuses = ["draft", "active", "stale", "contradicted", "archived"] as const
export const GateSeverities = ["hard", "warning"] as const
export const PromotionDecisions = ["approved", "blocked", "needs_review"] as const
export const HandoffStatuses = ["pending", "injected", "admitted", "acknowledged", "stale", "failed"] as const

export type EvidenceType = (typeof EvidenceTypes)[number]
export type ExperimentStatus = (typeof ExperimentStatuses)[number]
export type ExperimentStage = (typeof ExperimentStages)[number]
export type OverfitRisk = (typeof OverfitRisks)[number]
export type ExperienceType = (typeof ExperienceTypes)[number]
export type ConfidenceLevel = (typeof ConfidenceLevels)[number]
export type MemoryStatus = (typeof MemoryStatuses)[number]
export type GateSeverity = (typeof GateSeverities)[number]
export type PromotionDecision = (typeof PromotionDecisions)[number]
export type HandoffStatus = (typeof HandoffStatuses)[number]

export type EvidenceRow = {
  id: string
  evidence_type: EvidenceType
  uri: string | null
  file_path: string | null
  commit_hash: string | null
  message_id: string | null
  experiment_id: string | null
  description: string
  created_at: number
  checksum: string | null
}

export type ExperienceRow = {
  id: string
  type: ExperienceType
  situation: string
  trigger_conditions_json: string
  action_taken: string
  outcome: string
  lesson: string
  reuse_rule: string
  anti_rule: string
  confidence: ConfidenceLevel
  status: MemoryStatus
  last_verified_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

export type ExperimentRow = {
  id: string
  title: string
  symbol: string
  timeframe: string
  strategy: string
  hypothesis: string
  implementation_summary: string
  test_conditions_json: string
  metrics_json: string
  result_status: ExperimentStatus
  stage: ExperimentStage
  overfit_risk: OverfitRisk
  created_at: number
  updated_at: number
}
