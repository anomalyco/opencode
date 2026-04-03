/**
 * Task Model
 *
 * Defines the data structures for tasks flowing through OpenAgent.
 * A task is a high-level unit of work submitted by a user or external channel.
 * The orchestrator decomposes tasks into subtasks and routes them to OpenCode.
 */

import { z } from "zod"

// ─── Task Status ──────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "planning" | "running" | "completed" | "failed" | "cancelled"

// ─── Task Priority ────────────────────────────────────────────────────────────

export type TaskPriority = "low" | "normal" | "high" | "critical"

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
}

export function comparePriority(a: TaskPriority, b: TaskPriority): number {
  return PRIORITY_WEIGHT[b] - PRIORITY_WEIGHT[a]
}

// ─── Subtask ──────────────────────────────────────────────────────────────────

/**
 * A subtask is one atomic unit of work executed by a single OpenCode session.
 * The orchestrator creates these when decomposing a parent task.
 */
export interface Subtask {
  id: string
  parentId: string
  description: string
  prompt: string
  /** Which OpenCode agent role to use (build/explore/plan/general) */
  agentRole: string
  /** IDs of subtasks that must complete before this one starts */
  dependsOn: string[]
  status: TaskStatus
  result?: string
  error?: string
  sessionId?: string
  startedAt?: Date
  completedAt?: Date
}

// ─── Task ─────────────────────────────────────────────────────────────────────

/**
 * A top-level task submitted by a user through any channel.
 * Gets decomposed by the orchestrator into subtasks.
 */
export interface Task {
  id: string
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus

  /** Source channel that submitted the task */
  source: {
    channel: "http" | "github" | "slack" | "discord" | "cli"
    metadata: Record<string, unknown>
  }

  /** Subtasks created during planning phase */
  subtasks: Subtask[]

  /** Final synthesized result */
  result?: string
  error?: string

  createdAt: Date
  startedAt?: Date
  completedAt?: Date

  /** Callbacks for streaming progress to the source channel */
  onProgress?: (update: TaskProgressUpdate) => void | Promise<void>
}

// ─── Progress Update ──────────────────────────────────────────────────────────

export type TaskProgressUpdate =
  | { type: "planning"; taskId: string }
  | { type: "subtask_started"; taskId: string; subtask: Subtask }
  | { type: "subtask_tool"; taskId: string; subtaskId: string; tool: string; title: string }
  | { type: "subtask_completed"; taskId: string; subtask: Subtask }
  | { type: "completed"; taskId: string; result: string }
  | { type: "failed"; taskId: string; error: string }

// ─── Zod schemas for external input validation ─────────────────────────────────

export const CreateTaskInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
})
export type CreateTaskInput = z.infer<typeof CreateTaskInput>

// ─── Plan ─────────────────────────────────────────────────────────────────────

/**
 * The plan produced by the orchestrator LLM before executing a task.
 * Contains the list of subtasks in dependency order.
 */
export const Plan = z.object({
  summary: z.string().describe("One-sentence summary of what this task will do"),
  subtasks: z.array(
    z.object({
      id: z.string().describe("Short unique ID like 'step-1'"),
      description: z.string().describe("3-5 word description of this subtask"),
      prompt: z.string().describe("Detailed prompt to send to the OpenCode agent"),
      agentRole: z
        .enum(["build", "explore", "plan", "general"])
        .describe("Which OpenCode agent role handles this subtask"),
      dependsOn: z.array(z.string()).describe("IDs of subtasks that must finish first"),
    }),
  ),
})
export type Plan = z.infer<typeof Plan>
