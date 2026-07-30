import { Effect, Layer, Context, Database, Schema, Option, pipe } from "effect"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import crypto from "crypto"

// ===== TYPES =====
export interface Task {
  id: string
  sessionID: SessionSchema.ID
  goal: string
  description: string
  type: TaskType
  priority: TaskPriority
  status: TaskStatus
  currentStep: number
  totalSteps: number
  dependencies: string[]
  outputSpecification?: OutputSpecification
  acceptanceCriteria: string[]
  parentTaskID?: string
  result?: string
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  context: TaskContext
  metadata: TaskMetadata
  completionPercentage: number
  deadline?: Date
  onTrack?: boolean
}

export type TaskType = 
  | "research" 
  | "development" 
  | "testing" 
  | "documentation" 
  | "review" 
  | "deployment"
  | "debugging" 
  | "optimization" 
  | "architecture"

export type TaskPriority = "low" | "medium" | "high" | "critical"

export type TaskStatus = 
  | "pending" 
  | "in_progress" 
  | "completed" 
  | "blocked" 
  | "cancelled"

export interface TaskContext {
  tools: string[]
  programmingLanguages: string[]
  frameworks: string[]
  dataSources: string[]
  stakeholders: string[]
  businessImpact: string
}

export interface OutputSpecification {
  format: OutputFormat
  schema?: any
  examples?: any[]
}

export type OutputFormat = "json" | "text" | "code" | "markdown" | "html" | "file"

export interface TaskMetadata {
  createdBy: string
  version: number
  tags: string[]
  labels: string[]
}

export interface TaskState {
  activeTasks: Task[]
  onTrack: boolean
  message: string
  driftDetected: boolean
  driftCount: number
  lastValidation: Date
  reflectionCount: number
  alignmentScore: number
}

export interface AlignmentResult {
  onTrack: boolean
  message: string
  driftReasons?: string[]
  suggestions?: string[]
}

export interface CreateTaskInput {
  sessionID: SessionSchema.ID
  goal: string
  description?: string
  type?: TaskType
  priority?: TaskPriority
  totalSteps?: number
  dependencies?: string[]
  outputSpecification?: OutputSpecification
  acceptanceCriteria?: string[]
  parentTaskID?: string
  context?: Partial<TaskContext>
  deadline?: Date
  result?: string
  metadata?: Partial<TaskMetadata>
}

export interface TaskList {
  tasks: Task[]
  sessionID: SessionSchema.ID
  createdAt: Date
  lastUpdated: Date
}

export interface ReflectiveContext {
  beforeState: TaskState
  alignment: AlignmentResult
  currentTask: Task | null
  urgentTasks: Task[]
  projectTimeline: TaskTimeline
  timestamp: Date
  driftCount: number
}

export interface TaskTimeline {
  taskId: string
  goal: string
  status: TaskStatus
  completionPercentage: number
  deadline: Date
  onTrack: boolean
}

export interface GoalAlignment {
  aligned: boolean
  driftReasons: string[]
  requiredCorrections: string[]
  newDirection: string | null
}

export interface TaskRegistry {
  readonly getState: (sessionID: SessionSchema.ID) => Effect.Effect<TaskState>
  readonly validateAlignment: (sessionID: SessionSchema.ID) => Effect.Effect<AlignmentResult>
  readonly updateTaskState: (sessionID: SessionSchema.ID, state: Partial<TaskState>) => Effect.Effect<void>
  readonly createTask: (task: CreateTaskInput) => Effect.Effect<Task>
  readonly updateTask: (id: string, updates: Partial<Task>) => Effect.Effect<void>
  readonly getActiveTasks: (sessionID: SessionSchema.ID) => Effect.Effect<Task[]>
  readonly validateTaskAlignment: (sessionID: string, taskId: string) => Effect.Effect<AlignmentResult>
}