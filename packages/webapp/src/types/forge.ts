// FORGE Type Definitions

export type TaskStatus =
  | "backlog"      // Não iniciada
  | "todo"         // Pronta para começar
  | "in_progress"  // Em execução
  | "review"       // Em revisão
  | "testing"      // Em teste
  | "blocked"      // Bloqueada
  | "done"         // Concluída
  | "cancelled"    // Cancelada

export type TaskPriority = "low" | "medium" | "high" | "urgent"

export type TaskType = "issue" | "pr" | "manual"

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped"

export type ActivityType =
  | "created"
  | "started"
  | "status_changed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "commit"
  | "comment"
  | "assigned"
  | "completed"
  | "cancelled"
  | "blocked"

export interface ForgeTask {
  id: string                    // Unique ID
  type: TaskType                // Type of task
  title: string                 // Task title
  description: string           // Full description
  status: TaskStatus            // Current status
  priority: TaskPriority        // Priority level

  // Git Integration
  githubId?: number             // GitHub issue/PR ID
  repoOwner?: string            // Repository owner
  repoName?: string             // Repository name
  branch?: string               // Working branch
  baseBranch?: string           // Base branch (main/master)
  prUrl?: string                // Pull request URL

  // OpenCode Integration
  sessionId?: string            // OpenCode session ID
  agentId?: string              // Agent executing
  agentModel?: string           // Model being used

  // Metadata
  assignee?: string             // Who is working on it
  labels: string[]              // Labels/tags
  createdAt: number             // Creation timestamp
  updatedAt: number             // Last update timestamp
  startedAt?: number            // When execution started
  completedAt?: number          // When completed

  // Execution
  steps: TaskStep[]             // Execution steps
  currentStep?: number          // Current step index
  progress: number              // 0-100%

  // Files
  filesChanged: FileChange[]    // Files modified
  commits: GitCommit[]          // Commits created

  // Activity
  activities: TaskActivity[]    // Activity history
}

export interface TaskStep {
  id: string
  index: number                 // Step number (0-based)
  description: string           // What this step does
  status: StepStatus            // Current status
  tool?: string                 // Tool used (bash, edit, etc)
  toolInput?: any               // Tool input parameters
  startedAt?: number            // When started
  completedAt?: number          // When completed
  duration?: number             // Duration in ms
  output?: string               // Step output
  error?: string                // Error message if failed
}

export interface TaskActivity {
  id: string
  type: ActivityType
  timestamp: number
  actor: "user" | "agent" | "system"
  message: string
  metadata?: Record<string, any>
}

export interface GitCommit {
  sha: string
  message: string
  author: string
  timestamp: number
  filesChanged: string[]
  additions: number
  deletions: number
}

export interface FileChange {
  path: string
  status: "added" | "modified" | "deleted"
  additions: number
  deletions: number
}

// API Request/Response Types

export interface CreateTaskInput {
  type: TaskType
  title: string
  description: string
  priority?: TaskPriority
  labels?: string[]
  repoOwner?: string
  repoName?: string
  baseBranch?: string
  githubId?: number
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assignee?: string
  labels?: string[]
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[]
  priority?: TaskPriority | TaskPriority[]
  type?: TaskType | TaskType[]
  assignee?: string
  labels?: string[]
  search?: string
}

// WebSocket Event Types

export type ForgeEventType =
  | "forge.task.created"
  | "forge.task.updated"
  | "forge.task.deleted"
  | "forge.task.status_changed"
  | "forge.task.started"
  | "forge.task.paused"
  | "forge.task.cancelled"
  | "forge.task.completed"
  | "forge.task.step_started"
  | "forge.task.step_completed"
  | "forge.task.step_failed"
  | "forge.task.progress"
  | "forge.task.commit"
  | "forge.task.activity"

export interface ForgeEvent {
  type: ForgeEventType
  taskId: string
  timestamp: number
  data: any
}

// Statistics & Metrics

export interface ForgeStats {
  totalTasks: number
  byStatus: Record<TaskStatus, number>
  byPriority: Record<TaskPriority, number>
  averageCompletionTime: number // in ms
  successRate: number // 0-100%
  tasksCompletedToday: number
  tasksInProgress: number
}

// GitHub Integration Types

export interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string
  state: "open" | "closed"
  labels: string[]
  assignee?: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface GitHubPR {
  id: number
  number: number
  title: string
  body: string
  state: "open" | "closed" | "merged"
  labels: string[]
  assignee?: string
  branch: string
  baseBranch: string
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface GitHubRepo {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
}
