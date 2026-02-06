import { TaskSummaryBoard } from "./board"
import { AgentDecisionCenter, type AgentAction } from "./decision"
import { EVENTS, type EventType } from "./events"
import type { TaskSummary, TaskEvent } from "./types"
import { createExecutor, type ExecutorContext } from "./executor"
import { AsyncQueue } from "@/util/queue"
import { Log } from "@/util/log"

const log = Log.create({ service: "work-queue.loop" })

const TICK_IDLE_TIMEOUT = 50
const TICK_BUSY_TIMEOUT = 5

/**
 * 任务事件循环
 * 
 * 职责：
 * 1. 管理任务队列和执行状态
 * 2. 调度任务执行并处理事件
 * 
 * 线程模型：
 * @VertxThreadSafety 异步非阻塞事件循环
 */
export class EventLoop {
  private board: TaskSummaryBoard
  private decision: AgentDecisionCenter
  private runningTasks: Map<string, { startTime: number; lastHeartbeat: number; priority: number }> = new Map()
  private taskAbortControllers: Map<string, AbortController> = new Map()
  private maxConcurrency = 2
  private eventQueue: AsyncQueue<TaskEvent> = new AsyncQueue()
  private pendingQueue: Map<string, number> = new Map()
  private abortController: AbortController
  private isRunning = false
  private wakeUpResolver: (() => void) | null = null

  /**
   * 构造函数
   * @param sessionID 会话ID
   * @param board 可选的任务板
   */
  constructor(sessionID: string, board?: TaskSummaryBoard) {
    this.board = board ?? new TaskSummaryBoard()
    this.decision = new AgentDecisionCenter()
    this.abortController = new AbortController()
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.board.on(EVENTS.TASK_COMPLETED, (event) => {
      if (event.taskID) {
        this.onTaskComplete(event.taskID)
      }
    })

    this.board.on(EVENTS.TASK_ERROR, (event) => {
      if (event.taskID) {
        this.onTaskError(event.taskID)
      }
    })

    this.board.on(EVENTS.TASK_BLOCKED, (event) => {
      if (event.taskID) {
        this.onTaskBlocked(event.taskID)
      }
    })

    this.board.on(EVENTS.TASK_SUBMIT, (event) => {
      if (event.taskID) {
        this.queueTask(event.taskID)
      }
    })

    this.board.on(EVENTS.USER_INPUT, (event) => {
      this.onUserInput(event)
    })

    this.board.on(EVENTS.USER_INTERRUPT, (event) => {
      this.onUserInterrupt(event)
    })
  }

  private queueTask(taskID: string): void {
    const task = this.board.get(taskID)
    if (!task) return

    this.pendingQueue.set(taskID, task.priority)
    this.wakeUp()
  }

  /**
   * 启动事件循环
   */
  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("EventLoop started")

    while (this.isRunning && !this.abortController.signal.aborted) {
      try {
        await this.tick()
      } catch (error) {
        log.error("Tick error", { error })
      }
    }

    this.cleanup()
    log.info("EventLoop stopped")
  }

  /**
   * 停止事件循环
   */
  stop(): void {
    this.isRunning = false
    this.abortController.abort()
    this.wakeUp()
  }

  private cleanup(): void {
    for (const [, controller] of this.taskAbortControllers) {
      controller.abort()
    }
    this.runningTasks.clear()
    this.taskAbortControllers.clear()
    this.pendingQueue.clear()
  }

  private wakeUp(): void {
    if (this.wakeUpResolver) {
      this.wakeUpResolver()
      this.wakeUpResolver = null
    }
  }

  private async tick(): Promise<void> {
    const canSchedule = this.canSchedule()

    if (canSchedule) {
      const action = this.decision.decideNext(this.board)
      if (action.type !== "idle" && action.type !== "wait") {
        await this.executeAction(action)
        return
      }
    }

    const event = await Promise.race([
      this.eventQueue.next(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), canSchedule ? TICK_BUSY_TIMEOUT : TICK_IDLE_TIMEOUT),
      ),
    ])

    if (event) {
      await this.handleEvent(event)
    }
  }

  private getNextTask(): string | null {
    let bestTask: string | null = null
    let bestPriority = -Infinity

    for (const [taskID, priority] of this.pendingQueue) {
      const task = this.board.get(taskID)
      if (task && task.status === "pending" && priority > bestPriority) {
        bestPriority = priority
        bestTask = taskID
      }
    }

    return bestTask
  }

  private async handleEvent(event: TaskEvent): Promise<void> {
    switch (event.type) {
      case EVENTS.TASK_SUBMIT:
        if (event.taskID) {
          this.queueTask(event.taskID)
        }
        break
      case EVENTS.USER_INPUT:
        await this.onUserInput(event)
        break
      case EVENTS.USER_INTERRUPT:
        await this.onUserInterrupt(event)
        break
      case EVENTS.TASK_COMPLETED:
        if (event.taskID) await this.onTaskComplete(event.taskID)
        break
      case EVENTS.TASK_ERROR:
        if (event.taskID) await this.onTaskError(event.taskID)
        break
      case EVENTS.TASK_BLOCKED:
        if (event.taskID) await this.onTaskBlocked(event.taskID)
        break
    }
  }

  private pauseTask(taskID: string, checkpoint?: any): void {
    const controller = this.taskAbortControllers.get(taskID)
    if (controller) {
      controller.abort()
      this.taskAbortControllers.delete(taskID)
    }
    this.runningTasks.delete(taskID)
    this.pendingQueue.delete(taskID)
    this.board.pause(taskID, checkpoint)
  }

  private async executeAction(action: AgentAction): Promise<void> {
    switch (action.type) {
      case "start_next":
        this.startTask(action.taskID)
        break
      case "continue":
        break
      case "pause":
        this.pauseTask(action.taskID, action.checkpoint)
        break
      case "resume":
        this.board.resume(action.taskID)
        this.startTask(action.taskID)
        break
      case "unblock":
        for (const taskID of action.taskIDs) {
          this.board.unblock(taskID)
          this.pendingQueue.delete(taskID)
          const task = this.board.get(taskID)
          if (task) {
            this.pendingQueue.set(taskID, task.priority)
          }
        }
        this.wakeUp()
        break
      case "handle_error":
        for (const taskID of action.taskIDs) {
          this.pendingQueue.delete(taskID)
          this.board.error(taskID, "Task failed")
        }
        break
      case "idle":
      case "wait":
      case "interrupt":
        break
    }
  }

  private canSchedule(): boolean {
    if (this.runningTasks.size >= this.maxConcurrency) return false
    if (this.runningTasks.size === 0) return true
    const oldestTask = Array.from(this.runningTasks.values()).reduce((a, b) => (a.startTime < b.startTime ? a : b))
    // 使用 lastHeartbeat 来判断是否繁忙，而不是 startTime
    const mostRecentHeartbeat = Array.from(this.runningTasks.values()).reduce((a, b) => (a.lastHeartbeat > b.lastHeartbeat ? a : b))
    return Date.now() - mostRecentHeartbeat.lastHeartbeat > TICK_BUSY_TIMEOUT * 3
  }

  private startTask(taskID: string): void {
    const task = this.board.get(taskID)
    if (!task) return
    if (this.runningTasks.has(taskID)) return

    const controller = new AbortController()
    this.taskAbortControllers.set(taskID, controller)
    this.board.start(taskID)
    log.info("Task started", { taskID, type: task.type, priority: task.priority })

    const now = Date.now()
    this.runningTasks.set(taskID, { startTime: now, lastHeartbeat: now, priority: task.priority })
    this.pendingQueue.delete(taskID)
    void this.runTask(task, controller)
  }

  private async runTask(task: TaskSummary, controller: AbortController): Promise<void> {
    const executor = createExecutor(task)

    const ctx: ExecutorContext = {
      taskID: task.id,
      board: this.board,
      abortSignal: controller.signal,
      sessionID: "",
      agent: null as any,
      model: null as any,
      permission: [],
      messages: [],
      tools: {},
      onProgress: (progress, summary) => {
        this.board.updateProgress(task.id, progress, summary)
      },
      onHeartbeat: () => {
        const taskInfo = this.runningTasks.get(task.id)
        if (taskInfo) {
          taskInfo.lastHeartbeat = Date.now()
        }
      },
    }

    try {
      const result = await executor.execute(ctx)
      this.board.complete(task.id, result, "Task completed")
      log.info("Task completed", {
        taskID: task.id,
        duration: Date.now() - (this.runningTasks.get(task.id)?.startTime ?? Date.now()),
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.board.error(task.id, errorMsg)
      log.error("Task error", { taskID: task.id, error: errorMsg })
    } finally {
      this.runningTasks.delete(task.id)
      this.taskAbortControllers.delete(task.id)
      this.wakeUp()
    }
  }

  private async onTaskComplete(taskID: string): Promise<void> {
    this.runningTasks.delete(taskID)
    this.taskAbortControllers.delete(taskID)
    const action = this.decision.handleTaskComplete(this.board, taskID)
    await this.executeAction(action)
    this.wakeUp()
  }

  private async onTaskError(taskID: string): Promise<void> {
    const task = this.board.get(taskID)
    if (!task) return
    const action = this.decision.handleTaskError(this.board, [task])
    await this.executeAction(action)
    this.wakeUp()
  }

  private async onTaskBlocked(taskID: string): Promise<void> {
    const task = this.board.get(taskID)
    if (!task) return
    const action = this.decision.handleBlock(this.board, task)
    await this.executeAction(action)
  }

  private async onUserInput(event: TaskEvent): Promise<void> {
    const input = event.data?.input
    if (!input) return
    const action = this.decision.handleUserInput(this.board, input)
    await this.executeAction(action)
  }

  private async onUserInterrupt(event: TaskEvent): Promise<void> {
    const current = this.board.getCurrentTask()
    if (!current) return

    const controller = this.taskAbortControllers.get(current.id)
    if (controller) {
      controller.abort()
    }
    this.runningTasks.delete(current.id)
    this.taskAbortControllers.delete(current.id)
    this.board.pause(current.id, { interrupted: true, timestamp: Date.now() })
    this.wakeUp()
  }

  publishEvent(type: EventType, data?: Record<string, any>): void {
    this.eventQueue.push({ type, timestamp: Date.now(), data })
  }

  getBoard(): TaskSummaryBoard {
    return this.board
  }

  getStats(): { running: string[]; pending: number; completed: number; error: number; queued: number } {
    const stats = this.board.stats()
    return {
      running: Array.from(this.runningTasks.keys()),
      pending: stats.pending + stats.blocked,
      completed: stats.completed,
      error: stats.error,
      queued: this.pendingQueue.size,
    }
  }
}
