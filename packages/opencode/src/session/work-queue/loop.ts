import { TaskSummaryBoard } from "./board"
import { AgentDecisionCenter, type AgentAction } from "./decision"
import { EVENTS, type EventType } from "./events"
import type { TaskSummary, TaskEvent } from "./types"
import { createExecutor, type ExecutorContext } from "./executor"
import { AsyncQueue } from "@/util/queue"
import { Log } from "@/util/log"

const log = Log.create({ service: "work-queue.loop" })

export class EventLoop {
  private board: TaskSummaryBoard
  private decision: AgentDecisionCenter
  private runningTasks: Set<string> = new Set()
  private taskAbortControllers: Map<string, AbortController> = new Map()
  private maxConcurrency = 2
  private eventQueue: AsyncQueue<TaskEvent> = new AsyncQueue()
  private abortController: AbortController
  private isRunning = false

  constructor(sessionID: string) {
    this.board = new TaskSummaryBoard()
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
      if (event.taskID && this.canSchedule()) {
        this.startTask(event.taskID)
      }
    })

    this.board.on(EVENTS.USER_INPUT, (event) => {
      this.onUserInput(event)
    })

    this.board.on(EVENTS.USER_INTERRUPT, (event) => {
      this.onUserInterrupt(event)
    })
  }

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

    log.info("EventLoop stopped")
  }

  stop(): void {
    this.isRunning = false
    this.abortController.abort()
  }

  private async tick(): Promise<void> {
    const event = await Promise.race([
      this.eventQueue.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ])

    if (event) {
      await this.handleEvent(event)
      return
    }

    if (this.canSchedule()) {
      const action = this.decision.decideNext(this.board)
      await this.executeAction(action)
    }

    await Bun.sleep(10)
  }

  private async handleEvent(event: TaskEvent): Promise<void> {
    switch (event.type) {
      case EVENTS.TASK_SUBMIT:
        if (event.taskID && this.canSchedule()) {
          this.startTask(event.taskID)
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
        }
        break
      case "handle_error":
        for (const taskID of action.taskIDs) {
          this.board.error(taskID, "Task failed")
        }
        break
      case "idle":
      case "wait":
        break
    }
  }

  private canSchedule(): boolean {
    return this.runningTasks.size < this.maxConcurrency
  }

  private startTask(taskID: string): void {
    const task = this.board.get(taskID)
    if (!task) return
    if (this.runningTasks.has(taskID)) return

    const controller = new AbortController()
    this.taskAbortControllers.set(taskID, controller)
    this.board.start(taskID)
    log.info("Task started", { taskID, type: task.type })

    this.runningTasks.add(taskID)
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
    }

    try {
      const result = await executor.execute(ctx)
      this.board.complete(task.id, result, "Task completed")
      log.info("Task completed", { taskID: task.id })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.board.error(task.id, errorMsg)
      log.error("Task error", { taskID: task.id, error: errorMsg })
    } finally {
      this.runningTasks.delete(task.id)
      this.taskAbortControllers.delete(task.id)
    }
  }

  private onTaskComplete(taskID: string): void {
    this.runningTasks.delete(taskID)
    this.taskAbortControllers.delete(taskID)
    const action = this.decision.handleTaskComplete(this.board, taskID)
    this.executeAction(action)
  }

  private onTaskError(taskID: string): void {
    const task = this.board.get(taskID)
    if (!task) return
    const action = this.decision.handleTaskError(this.board, [task])
    this.executeAction(action)
  }

  private onTaskBlocked(taskID: string): void {
    const task = this.board.get(taskID)
    if (!task) return
    const action = this.decision.handleBlock(this.board, task)
    this.executeAction(action)
  }

  private onUserInput(event: TaskEvent): void {
    const input = event.data?.input
    if (!input) return
    const action = this.decision.handleUserInput(this.board, input)
    this.executeAction(action)
  }

  private onUserInterrupt(event: TaskEvent): void {
    const current = this.board.getCurrentTask()
    if (!current) return

    const controller = this.taskAbortControllers.get(current.id)
    if (controller) {
      controller.abort()
    }
    this.runningTasks.delete(current.id)
    this.board.pause(current.id, { interrupted: true, timestamp: Date.now() })
  }

  publishEvent(type: EventType, data?: Record<string, any>): void {
    this.eventQueue.push({ type, timestamp: Date.now(), data })
  }

  getBoard(): TaskSummaryBoard {
    return this.board
  }

  getStats(): { running: string | null; pending: number; completed: number; error: number } {
    const stats = this.board.stats()
    return {
      running: this.runningTasks.values().next().value ?? null,
      pending: stats.pending + stats.blocked,
      completed: stats.completed,
      error: stats.error,
    }
  }
}
