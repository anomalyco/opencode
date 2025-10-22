/**
 * Type definitions for the Autonomous Workflow System
 */

import type { Project } from "../project/index.js"
import type { Agent } from "../agent/agent.js"

// ============================================================================
// Workflow Stage & Status
// ============================================================================

export type WorkflowStage = "planning" | "coding" | "testing" | "deployment"

export type WorkflowStatus = "running" | "paused" | "completed" | "failed"

export type TaskStatus = "pending" | "active" | "completed" | "failed" | "skipped"

// ============================================================================
// Task Management
// ============================================================================

export interface Task {
  id: string
  workflowID: string
  title: string
  description: string
  stage: WorkflowStage
  status: TaskStatus
  agentID?: string
  dependencies: string[]
  estimatedTime: number
  actualTime?: number
  priority: number
  metadata: Record<string, any>
  time: {
    created: number
    started?: number
    completed?: number
  }
}

export interface TaskBreakdown {
  title: string
  description: string
  tasks: Omit<Task, "id" | "workflowID" | "time">[]
  estimatedDuration: number
  complexity: "low" | "medium" | "high"
}

// ============================================================================
// Workflow Management
// ============================================================================

export interface WorkflowInstance {
  id: string
  workspaceID: string
  title: string
  description: string
  prd: string
  currentStage: WorkflowStage
  status: WorkflowStatus
  tasks: Task[]
  history: WorkflowEvent[]
  time: {
    created: number
    updated: number
    started?: number
    completed?: number
  }
}

export type WorkflowEventType =
  | "workflow_created"
  | "workflow_started"
  | "stage_started"
  | "stage_completed"
  | "task_started"
  | "task_progress"
  | "task_completed"
  | "task_failed"
  | "workflow_paused"
  | "workflow_resumed"
  | "workflow_completed"
  | "workflow_failed"
  | "error"

export interface WorkflowEvent {
  id: string
  workflowID: string
  timestamp: number
  stage: WorkflowStage
  type: WorkflowEventType
  agentID?: string
  taskID?: string
  data: Record<string, any>
}

// ============================================================================
// Workspace Management
// ============================================================================

export interface Repository {
  id: string
  name: string
  path: string
  branch: string
  remote?: string
}

export interface WorkspaceConfig {
  defaultBranch: string
  testCommand?: string
  buildCommand?: string
  deployCommand?: string
  environmentVariables: Record<string, string>
}

export interface Workspace extends Omit<Project.Info, "type"> {
  repositories: Repository[]
  agents: string[] // Agent IDs configured for this workspace
  configuration: WorkspaceConfig
}

// ============================================================================
// Metrics & Analytics
// ============================================================================

export interface WorkflowMetrics {
  workflowID: string
  duration: {
    total: number
    planning: number
    coding: number
    testing: number
    deployment: number
  }
  tasks: {
    total: number
    completed: number
    failed: number
    skipped: number
  }
  agents: Record<string, AgentMetrics>
  tests: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
  errors: WorkflowError[]
  retries: number
  costEstimate: number
}

export interface AgentMetrics {
  agentID: string
  invocations: number
  successRate: number
  averageDuration: number
  tokensUsed: number
  toolsUsed: Record<string, number>
  errorsEncountered: string[]
}

export interface WorkflowError {
  id: string
  workflowID: string
  timestamp: number
  stage: WorkflowStage
  agentID: string
  taskID?: string
  type: string
  message: string
  stack?: string
  context: Record<string, any>
  resolved: boolean
  resolution?: string
}

export interface AggregateMetrics {
  timeRange: {
    start: number
    end: number
  }
  totalWorkflows: number
  successfulWorkflows: number
  failedWorkflows: number
  averageDuration: number
  stageMetrics: Record<WorkflowStage, {
    averageDuration: number
    successRate: number
  }>
  topErrors: Array<{
    type: string
    count: number
    message: string
  }>
  agentPerformance: Record<string, {
    totalInvocations: number
    successRate: number
    averageDuration: number
  }>
}

// ============================================================================
// Heuristics & Pattern Detection
// ============================================================================

export interface FailurePattern {
  id: string
  type: string
  description: string
  occurrences: number
  stages: WorkflowStage[]
  errorSignature: string
  suggestedFix: string
  confidence: number
  firstSeen: number
  lastSeen: number
}

export interface Bottleneck {
  stage: WorkflowStage
  agentID: string
  averageDelay: number
  frequency: number
  causes: string[]
}

export interface Optimization {
  id: string
  target: "prompt" | "agent_config" | "workflow_structure"
  description: string
  expectedImprovement: number
  riskLevel: "low" | "medium" | "high"
  implementation: OptimizationAction
}

export interface OptimizationAction {
  type: string
  parameters: Record<string, any>
}

// ============================================================================
// Self-Healing System
// ============================================================================

export type AdaptationType = "prompt_modification" | "tool_restriction" | "workflow_adjustment"

export interface Adaptation {
  id: string
  type: AdaptationType
  target: string // Agent ID, workflow stage, etc.
  changes: AdaptationChange[]
  reason: string
  appliedAt: number
  rolledBackAt?: number
  effectiveness?: number
  active: boolean
}

export interface AdaptationChange {
  field: string
  before: any
  after: any
}

export interface WorkflowContext {
  workflowID: string
  currentStage: WorkflowStage
  currentTask?: Task
  recentErrors: WorkflowError[]
  metrics: WorkflowMetrics
}

export interface Issue {
  id: string
  type: string
  description: string
  severity: "low" | "medium" | "high" | "critical"
  context: WorkflowContext
  suggestedAction?: string
}

// ============================================================================
// Workflow Configuration
// ============================================================================

export interface WorkflowConfig {
  stages: WorkflowStage[]
  autoProgress: boolean
  retryOnFailure: boolean
  maxRetries: number
  stageTimeouts?: Record<WorkflowStage, number>
  approvalRequired?: WorkflowStage[]
}

// ============================================================================
// TaskMaster AI
// ============================================================================

export interface TaskMasterConfig {
  model?: {
    providerID: string
    modelID: string
  }
  temperature?: number
  maxTokens?: number
}

export interface ValidationResult {
  valid: boolean
  errors: Array<{
    taskID?: string
    field: string
    message: string
  }>
  warnings: Array<{
    taskID?: string
    field: string
    message: string
  }>
}

// ============================================================================
// Metrics Filter & Query
// ============================================================================

export interface MetricsFilter {
  workspaceID?: string
  status?: WorkflowStatus
  stage?: WorkflowStage
  dateRange?: {
    start: number
    end: number
  }
  agentID?: string
}

export interface TimeRange {
  start: number
  end: number
}
