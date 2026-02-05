/**
 * WorkQueue Session Processor - 轻量封装
 *
 * 职责：
 * 1. 提供公共 API (submitTask, cancelTask 等)
 * 2. 依赖 EventLoop 进行真正的并发调度
 */

import { Log } from "@/util/log"
import { EventLoop, TaskSummaryBoard, EVENTS, type ExecutorContext } from "./index"
import { DEFAULT_TIMEOUT, MAX_CONCURRENCY } from "./config"
import type { TaskSummary, TaskType } from "./types"

const log = Log.create({ service: "work-queue.processor" })

export interface WorkQueueProcessorConfig {
  maxConcurrency?: number
  llmTimeout?: number
  toolTimeout?: number
}

const DEFAULT_CONFIG: Required<WorkQueueProcessorConfig> = {
  maxConcurrency: MAX_CONCURRENCY,
  llmTimeout: DEFAULT_TIMEOUT.LLM,
  toolTimeout: DEFAULT_TIMEOUT.TOOL,
}

export interface TaskResult {
  taskID: string
  type: string
  success: boolean
  output?: string
  error?: string
  duration: number
}

export interface TaskInput {
  type: TaskType
  goal: string
  summary?: string
  priority?: number
}

export class WorkQueueSessionProcessor {
  private sessionID: string
  private eventLoop: EventLoop
  private board: TaskSummaryBoard
  private config: Required<WorkQueueProcessorConfig>
  private abortController: AbortController
  private isRunning = false
  private taskCallbacks: Map<string, { resolve: (r: TaskResult) => void; reject: (e: Error) => void }> = new Map()

  constructor(sessionID: string, config?: WorkQueueProcessorConfig) {
    this.sessionID = sessionID
    this.board = new TaskSummaryBoard()
    this.eventLoop = new EventLoop(sessionID)
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.abortController = new AbortController()
    this.setupCallbacks()
  }

  private setupCallbacks(): void {
    const board = this.eventLoop.getBoard()

    board.on("task:completed", (event) => {
      if (!event.taskID) return
      const callback = this.taskCallbacks.get(event.taskID)
      if (callback) {
        const task = board.get(event.taskID)
        callback.resolve({
          taskID: event.taskID,
          type: task?.type ?? "unknown",
          success: true,
          output: JSON.stringify(task?.result),
          duration: 0,
        })
        this.taskCallbacks.delete(event.taskID)
      }
    })

    board.on("task:error", (event) => {
      if (!event.taskID) return
      const callback = this.taskCallbacks.get(event.taskID)
      if (callback) {
        callback.reject(new Error(event.data?.error ?? "Task error"))
        this.taskCallbacks.delete(event.taskID)
      }
    })
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("WorkQueueSessionProcessor starting", { sessionID: this.sessionID })
    await this.eventLoop.start()
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return
    log.info("WorkQueueSessionProcessor stopping", { sessionID: this.sessionID })
    this.isRunning = false
    this.abortController.abort()
    this.eventLoop.stop()
  }

  async submitTask(input: TaskInput): Promise<TaskResult> {
    const task = this.board.create({
      type: input.type,
      goal: input.goal,
      summary: input.summary ?? "Task pending",
      priority: input.priority ?? 50,
      progress: 0,
      blockedBy: [],
      blocks: [],
    })

    log.info("Task submitted", { taskID: task.id, type: input.type })

    this.eventLoop.publishEvent(EVENTS.TASK_SUBMIT, { taskID: task.id, input })

    return new Promise((resolve, reject) => {
      this.taskCallbacks.set(task.id, { resolve, reject })
    })
  }

  async submitLLMTask(goal: string, priority?: number): Promise<TaskResult> {
    return this.submitTask({ type: "llm", goal, priority })
  }

  async submitToolTask(toolName: string, input: Record<string, any>, priority?: number): Promise<TaskResult> {
    return this.submitTask({
      type: "tool",
      goal: `${toolName} ${JSON.stringify(input)}`,
      priority,
    })
  }

  async submitSubtask(agent: string, prompt: string, priority?: number): Promise<TaskResult> {
    return this.submitTask({ type: "subtask", goal: agent, summary: prompt, priority })
  }

  async cancelTask(taskID: string): Promise<void> {
    this.board.cancel(taskID)

    const callback = this.taskCallbacks.get(taskID)
    if (callback) {
      callback.reject(new Error("Task cancelled"))
      this.taskCallbacks.delete(taskID)
    }

    log.info("Task cancelled", { taskID })
  }

  getStats(): { pending: number; running: number; completed: number; error: number; blocked: number; total: number } {
    return this.board.stats()
  }

  getBoard(): TaskSummaryBoard {
    return this.board
  }

  isActive(): boolean {
    return this.isRunning && this.board.stats().running > 0
  }
}

const processorCache: Map<string, WorkQueueSessionProcessor> = new Map()

export function getOrCreateProcessor(sessionID: string, config?: WorkQueueProcessorConfig): WorkQueueSessionProcessor {
  let processor = processorCache.get(sessionID)

  if (!processor || !processor.isActive()) {
    processor = new WorkQueueSessionProcessor(sessionID, config)
    processorCache.set(sessionID, processor)
  }

  return processor
}

export async function stopProcessor(sessionID: string): Promise<void> {
  const processor = processorCache.get(sessionID)
  if (processor) {
    await processor.stop()
    processorCache.delete(sessionID)
  }
}

export async function createAndStart(
  sessionID: string,
  config?: WorkQueueProcessorConfig,
): Promise<WorkQueueSessionProcessor> {
  const processor = getOrCreateProcessor(sessionID, config)
  await processor.start()
  return processor
}
