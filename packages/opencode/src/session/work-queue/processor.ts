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

/**
 * WorkQueue 会话处理器
 * 
 * 职责：
 * 1. 提供任务提交、取消等公共 API
 * 2. 依赖 EventLoop 进行并发调度
 * 
 * 线程模型：
 * @VertxThreadSafety
 */
export class WorkQueueSessionProcessor {
  private sessionID: string
  private eventLoop: EventLoop
  private board: TaskSummaryBoard
  private config: Required<WorkQueueProcessorConfig>
  private abortController: AbortController
  private isRunning = false
  private taskCallbacks: Map<string, { resolve: (r: TaskResult) => void; reject: (e: Error) => void }> = new Map()

  /**
   * 构造函数
   * @param sessionID 会话ID
   * @param config 配置项
   */
  constructor(sessionID: string, config?: WorkQueueProcessorConfig) {
    this.sessionID = sessionID
    this.board = new TaskSummaryBoard()
    this.eventLoop = new EventLoop(sessionID, this.board)
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.abortController = new AbortController()
    this.setupCallbacks()
  }

  private setupCallbacks(): void {
    this.board.on("task:completed", (event) => {
      if (!event.taskID) return
      const callback = this.taskCallbacks.get(event.taskID)
      if (callback) {
        const task = this.board.get(event.taskID)
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

    this.board.on("task:error", (event) => {
      if (!event.taskID) return
      const callback = this.taskCallbacks.get(event.taskID)
      if (callback) {
        callback.reject(new Error(event.data?.error ?? "Task error"))
        this.taskCallbacks.delete(event.taskID)
      }
    })
  }

  /**
   * 启动处理器
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("WorkQueueSessionProcessor starting", { sessionID: this.sessionID })
    await this.eventLoop.start()
  }

  /**
   * 停止处理器并清理资源
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return
    log.info("WorkQueueSessionProcessor stopping", { sessionID: this.sessionID })
    this.isRunning = false
    this.abortController.abort()
    this.eventLoop.stop()

    // 清理所有回调，防止内存泄漏 (Bug 5)
    for (const [taskID, callback] of this.taskCallbacks) {
      callback.reject(new Error("Processor stopped"))
      this.taskCallbacks.delete(taskID)
    }
  }

  /**
   * 提交通用任务
   * @param input 任务输入
   * @returns 任务结果
   */
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
    return this.isRunning
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
