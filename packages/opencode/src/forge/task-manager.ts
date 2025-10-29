import { ulid } from "ulid"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import z from "zod"

/**
 * FORGE Task Manager
 * Manages CRUD operations for FORGE tasks
 */

// Task Status
export const TaskStatus = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "testing",
  "blocked",
  "done",
  "cancelled",
])

export type TaskStatus = z.infer<typeof TaskStatus>

// Task Priority
export const TaskPriority = z.enum(["low", "medium", "high", "urgent"])
export type TaskPriority = z.infer<typeof TaskPriority>

// Task Type
export const TaskType = z.enum(["issue", "pr", "manual"])
export type TaskType = z.infer<typeof TaskType>

// Step Status
export const StepStatus = z.enum(["pending", "running", "completed", "failed", "skipped"])
export type StepStatus = z.infer<typeof StepStatus>

// Task Step
export const TaskStep = z.object({
  id: z.string(),
  index: z.number(),
  description: z.string(),
  status: StepStatus,
  tool: z.string().optional(),
  toolInput: z.any().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  duration: z.number().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
})

export type TaskStep = z.infer<typeof TaskStep>

// Task Activity
export const TaskActivity = z.object({
  id: z.string(),
  type: z.enum([
    "created",
    "started",
    "status_changed",
    "step_started",
    "step_completed",
    "step_failed",
    "commit",
    "comment",
    "assigned",
    "completed",
    "cancelled",
    "blocked",
  ]),
  timestamp: z.number(),
  actor: z.enum(["user", "agent", "system"]),
  message: z.string(),
  metadata: z.record(z.any()).optional(),
})

export type TaskActivity = z.infer<typeof TaskActivity>

// Git Commit
export const GitCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  timestamp: z.number(),
  filesChanged: z.array(z.string()),
  additions: z.number(),
  deletions: z.number(),
})

export type GitCommit = z.infer<typeof GitCommit>

// File Change
export const FileChange = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted"]),
  additions: z.number(),
  deletions: z.number(),
})

export type FileChange = z.infer<typeof FileChange>

// FORGE Task
export const ForgeTask = z.object({
  id: z.string(),
  type: TaskType,
  title: z.string(),
  description: z.string(),
  status: TaskStatus,
  priority: TaskPriority,

  // Git Integration
  githubId: z.number().optional(),
  repoOwner: z.string().optional(),
  repoName: z.string().optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  prUrl: z.string().optional(),

  // OpenCode Integration
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  agentModel: z.string().optional(),

  // Metadata
  assignee: z.string().optional(),
  labels: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),

  // Execution
  steps: z.array(TaskStep),
  currentStep: z.number().optional(),
  progress: z.number(),

  // Files
  filesChanged: z.array(FileChange),
  commits: z.array(GitCommit),

  // Activity
  activities: z.array(TaskActivity),
})

export type ForgeTask = z.infer<typeof ForgeTask>

// Create Task Input
export const CreateTaskInput = z.object({
  type: TaskType,
  title: z.string(),
  description: z.string(),
  priority: TaskPriority.default("medium"),
  labels: z.array(z.string()).default([]),
  repoOwner: z.string().optional(),
  repoName: z.string().optional(),
  baseBranch: z.string().optional(),
  githubId: z.number().optional(),
})

export type CreateTaskInput = z.infer<typeof CreateTaskInput>

// Update Task Input
export const UpdateTaskInput = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
})

export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>

export namespace TaskManager {
  const STORAGE_PREFIX = "forge/tasks"

  // Events
  export const Event = {
    Created: Bus.event(
      "forge.task.created",
      z.object({
        task: ForgeTask,
      }),
    ),
    Updated: Bus.event(
      "forge.task.updated",
      z.object({
        task: ForgeTask,
      }),
    ),
    Deleted: Bus.event(
      "forge.task.deleted",
      z.object({
        taskId: z.string(),
      }),
    ),
    StatusChanged: Bus.event(
      "forge.task.status_changed",
      z.object({
        taskId: z.string(),
        oldStatus: TaskStatus,
        newStatus: TaskStatus,
      }),
    ),
    Started: Bus.event(
      "forge.task.started",
      z.object({
        taskId: z.string(),
      }),
    ),
    Completed: Bus.event(
      "forge.task.completed",
      z.object({
        taskId: z.string(),
      }),
    ),
    Progress: Bus.event(
      "forge.task.progress",
      z.object({
        taskId: z.string(),
        progress: z.number(),
      }),
    ),
    StepStarted: Bus.event(
      "forge.task.step_started",
      z.object({
        taskId: z.string(),
        step: TaskStep,
      }),
    ),
    StepCompleted: Bus.event(
      "forge.task.step_completed",
      z.object({
        taskId: z.string(),
        step: TaskStep,
      }),
    ),
    StepFailed: Bus.event(
      "forge.task.step_failed",
      z.object({
        taskId: z.string(),
        step: TaskStep,
        error: z.string(),
      }),
    ),
    Commit: Bus.event(
      "forge.task.commit",
      z.object({
        taskId: z.string(),
        commit: GitCommit,
      }),
    ),
    Activity: Bus.event(
      "forge.task.activity",
      z.object({
        taskId: z.string(),
        activity: TaskActivity,
      }),
    ),
  }

  /**
   * Create a new task
   */
  export async function create(input: CreateTaskInput): Promise<ForgeTask> {
    const taskId = ulid()
    const now = Date.now()

    const task: ForgeTask = {
      id: taskId,
      type: input.type,
      title: input.title,
      description: input.description,
      status: "backlog",
      priority: input.priority,
      githubId: input.githubId,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      baseBranch: input.baseBranch || "main",
      labels: input.labels,
      createdAt: now,
      updatedAt: now,
      steps: [],
      progress: 0,
      filesChanged: [],
      commits: [],
      activities: [
        {
          id: ulid(),
          type: "created",
          timestamp: now,
          actor: "user",
          message: "Task created",
        },
      ],
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, task)
    await Bus.publish(Event.Created, { task })

    return task
  }

  /**
   * Get task by ID
   */
  export async function get(taskId: string): Promise<ForgeTask> {
    const task = await Storage.read(`${STORAGE_PREFIX}/${taskId}.json`, ForgeTask)
    return task
  }

  /**
   * List all tasks
   */
  export async function list(): Promise<ForgeTask[]> {
    const files = await Storage.list(STORAGE_PREFIX)
    const tasks: ForgeTask[] = []

    for (const file of files) {
      if (file.endsWith(".json")) {
        const task = await Storage.read(`${STORAGE_PREFIX}/${file}`, ForgeTask)
        tasks.push(task)
      }
    }

    // Sort by updatedAt descending
    tasks.sort((a, b) => b.updatedAt - a.updatedAt)

    return tasks
  }

  /**
   * Update task
   */
  export async function update(taskId: string, input: UpdateTaskInput): Promise<ForgeTask> {
    const task = await get(taskId)
    const oldStatus = task.status

    const updated: ForgeTask = {
      ...task,
      ...input,
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)
    await Bus.publish(Event.Updated, { task: updated })

    // If status changed, emit status changed event
    if (input.status && input.status !== oldStatus) {
      await Bus.publish(Event.StatusChanged, {
        taskId,
        oldStatus,
        newStatus: input.status,
      })

      // Add activity
      await addActivity(taskId, {
        type: "status_changed",
        actor: "user",
        message: `Status changed from ${oldStatus} to ${input.status}`,
        metadata: { oldStatus, newStatus: input.status },
      })
    }

    return updated
  }

  /**
   * Delete task
   */
  export async function remove(taskId: string): Promise<void> {
    await Storage.remove(`${STORAGE_PREFIX}/${taskId}.json`)
    await Bus.publish(Event.Deleted, { taskId })
  }

  /**
   * Add activity to task
   */
  export async function addActivity(
    taskId: string,
    activity: Omit<TaskActivity, "id" | "timestamp">,
  ): Promise<ForgeTask> {
    const task = await get(taskId)

    const newActivity: TaskActivity = {
      ...activity,
      id: ulid(),
      timestamp: Date.now(),
    }

    const updated: ForgeTask = {
      ...task,
      activities: [...task.activities, newActivity],
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)
    await Bus.publish(Event.Activity, { taskId, activity: newActivity })

    return updated
  }

  /**
   * Update task progress
   */
  export async function updateProgress(taskId: string, progress: number): Promise<ForgeTask> {
    const task = await get(taskId)

    const updated: ForgeTask = {
      ...task,
      progress,
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)
    await Bus.publish(Event.Progress, { taskId, progress })

    return updated
  }

  /**
   * Add step to task
   */
  export async function addStep(
    taskId: string,
    description: string,
  ): Promise<ForgeTask> {
    const task = await get(taskId)

    const step: TaskStep = {
      id: ulid(),
      index: task.steps.length,
      description,
      status: "pending",
    }

    const updated: ForgeTask = {
      ...task,
      steps: [...task.steps, step],
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)

    return updated
  }

  /**
   * Update step status
   */
  export async function updateStep(
    taskId: string,
    stepId: string,
    stepUpdate: Partial<TaskStep>,
  ): Promise<ForgeTask> {
    const task = await get(taskId)

    const updated: ForgeTask = {
      ...task,
      steps: task.steps.map((s) =>
        s.id === stepId
          ? { ...s, ...stepUpdate }
          : s
      ),
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)

    // Emit events based on status
    const step = updated.steps.find((s) => s.id === stepId)
    if (step) {
      if (step.status === "running") {
        await Bus.publish(Event.StepStarted, { taskId, step })
      } else if (step.status === "completed") {
        await Bus.publish(Event.StepCompleted, { taskId, step })
      } else if (step.status === "failed") {
        await Bus.publish(Event.StepFailed, { taskId, step, error: step.error || "Unknown error" })
      }
    }

    return updated
  }

  /**
   * Add commit to task
   */
  export async function addCommit(taskId: string, commit: GitCommit): Promise<ForgeTask> {
    const task = await get(taskId)

    const updated: ForgeTask = {
      ...task,
      commits: [...task.commits, commit],
      updatedAt: Date.now(),
    }

    await Storage.write(`${STORAGE_PREFIX}/${taskId}.json`, updated)
    await Bus.publish(Event.Commit, { taskId, commit })

    return updated
  }
}
