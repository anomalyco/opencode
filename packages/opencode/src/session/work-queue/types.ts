import { Identifier } from "@/id/id"
import { z } from "zod"
import type { TaskSummaryBoard } from "./board"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { PermissionNext } from "@/permission/next"
import type { ModelMessage, Tool } from "ai"

export type TaskType = "llm" | "tool" | "subtask" | "input" | "compact" | "system"

export type TaskStatus =
  | "created"
  | "pending"
  | "running"
  | "blocked"
  | "progress"
  | "paused"
  | "completed"
  | "error"
  | "cancelled"

export const TaskSummarySchema = z.object({
  id: Identifier.schema("task"),
  type: z.enum(["llm", "tool", "subtask", "input", "compact", "system"]),
  goal: z.string(),
  progress: z.number().min(0).max(100),
  status: z.enum(["created", "pending", "running", "blocked", "progress", "paused", "completed", "error", "cancelled"]),
  summary: z.string(),
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  checkpoint: z.any().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
  priority: z.number(),
})

export type TaskSummary = z.infer<typeof TaskSummarySchema>

export interface TaskEvent {
  type: string
  taskID?: string
  timestamp: number
  data?: Record<string, any>
}

export interface UserInput {
  sessionID: string
  content: string
  timestamp: number
}

export interface ExecutorContext {
  taskID: string
  board: TaskSummaryBoard
  abortSignal: AbortSignal
  sessionID: string
  agent: Agent.Info
  model: Provider.Model
  permission: PermissionNext.Ruleset
  messages: ModelMessage[]
  tools: Record<string, Tool>
  onProgress?: (progress: number, summary: string) => void
  onComplete?: (result: any) => void
  onError?: (error: string) => void
  onHeartbeat?: () => void
}

export interface TaskExecutor {
  execute(ctx: ExecutorContext): Promise<any>
  isInterruptible(): boolean
  saveCheckpoint(ctx: ExecutorContext): any
  getTimeout(): number
}
