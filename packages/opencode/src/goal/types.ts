export type GoalState =
  | "CREATED"
  | "PLANNING"
  | "ACTIVE"
  | "WAITING"
  | "BLOCKED"
  | "PAUSED"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BUDGET_EXCEEDED"

export interface Goal {
  id: string
  title: string
  objective: string
  state: GoalState
  createdAt: string
  updatedAt: string
  planId?: string
  currentStepId?: string
  progress: GoalProgress
  budget: GoalBudget
  verification?: VerificationSummary
  failureReason?: string
}

export interface GoalProgress {
  totalSteps: number
  completedSteps: number
  failedSteps: number
  blockedSteps: number
  percentComplete: number
}

export interface GoalBudget {
  maxTokens?: number
  usedTokens: number
  maxRuntimeMs?: number
  usedRuntimeMs: number
  maxSteps?: number
  usedSteps: number
  maxCostUsd?: number
  usedCostUsd: number
}

export interface VerificationSummary {
  required: number
  passed: number
  failed: number
  lastEvidenceId?: string
}

export interface GoalPlan {
  id: string
  goalId: string
  version: number
  steps: GoalStep[]
  createdAt: string
  updatedAt: string
}

export interface GoalStep {
  id: string
  title: string
  description: string
  status: GoalStepStatus
  dependencies: string[]
  verification: VerificationRequirement[]
}

export type GoalStepStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED" | "BLOCKED" | "SKIPPED"

export type VerificationRequirement =
  | CommandVerificationRequirement
  | FileExistsVerificationRequirement
  | FileContainsVerificationRequirement
  | ManualVerificationRequirement

export interface CommandVerificationRequirement {
  type: "COMMAND"
  command: string
  expectedExitCode: number
}

export interface FileExistsVerificationRequirement {
  type: "FILE_EXISTS"
  path: string
}

export interface FileContainsVerificationRequirement {
  type: "FILE_CONTAINS"
  path: string
  pattern: string
}

export interface ManualVerificationRequirement {
  type: "MANUAL"
  prompt: string
}

export type VerificationEvidence = CommandEvidence | FileEvidence | ManualEvidence

export interface EvidenceBase {
  id: string
  goalId: string
  stepId?: string
  type: VerificationRequirement["type"]
  passed: boolean
  createdAt: string
}

export interface CommandEvidence extends EvidenceBase {
  type: "COMMAND"
  command: string
  cwd: string
  expectedExitCode: number
  exitCode: number | null
  output: string
  outputPath?: string
  truncated: boolean
  timedOut: boolean
  aborted: boolean
  startedAt: string
  completedAt: string
}

export interface FileEvidence extends EvidenceBase {
  type: "FILE_EXISTS" | "FILE_CONTAINS"
  path: string
  expected?: string | boolean
  observed: string | boolean
}

export interface ManualEvidence extends EvidenceBase {
  type: "MANUAL"
  prompt: string
  approved: boolean
}

export interface GoalEvent {
  id: string
  goalId: string
  type: GoalEventType
  message: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type GoalEventType =
  | "GOAL_CREATED"
  | "GOAL_PLANNED"
  | "STATE_CHANGED"
  | "STEP_STARTED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "BUDGET_EXCEEDED"
  | "CHECKPOINT_CREATED"
  | "GOAL_PAUSED"
  | "GOAL_RESUMED"
  | "GOAL_CANCELLED"
  | "GOAL_COMPLETED"

export interface GoalCheckpoint {
  id: string
  goalId: string
  state: GoalState
  currentStepId?: string
  goalSnapshot: Goal
  planSnapshot?: GoalPlan
  createdAt: string
}
