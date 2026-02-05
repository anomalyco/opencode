import type { TaskSummary, TaskStatus, TaskEvent } from "./types"
import { Identifier } from "@/id/id"
import { EVENTS } from "./events"
import type { EventType } from "./events"

export class TaskSummaryBoard {
  private tasks: Map<string, TaskSummary> = new Map()
  private listeners: Map<EventType, Set<(event: TaskEvent) => void>> = new Map()

  create(input: Omit<TaskSummary, "id" | "createdAt" | "updatedAt" | "status">): TaskSummary {
    const id = Identifier.ascending("task")
    const now = Date.now()

    const summary: TaskSummary = {
      id,
      type: input.type,
      goal: input.goal,
      progress: 0,
      status: "pending",
      summary: input.summary || "Task pending",
      blockedBy: input.blockedBy || [],
      blocks: input.blocks || [],
      createdAt: now,
      updatedAt: now,
      priority: input.priority ?? 0,
    }

    this.tasks.set(id, summary)
    this.emit({ type: EVENTS.TASK_CREATED, taskID: id, timestamp: now, data: summary })

    return summary
  }

  update(id: string, updates: Partial<TaskSummary>): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    const updated: TaskSummary = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    }

    this.tasks.set(id, updated)
    this.emit({ type: EVENTS.TASK_UPDATED, taskID: id, timestamp: Date.now(), data: { old: task, new: updated } })

    return updated
  }

  updateProgress(id: string, progress: number, summaryText: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    return this.update(id, { progress, summary: summaryText })
  }

  block(id: string, blockedBy: string[]): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    const newBlockedBy = [...new Set([...task.blockedBy, ...blockedBy])]
    this.update(id, { blockedBy: newBlockedBy, status: "blocked" })

    for (const dep of blockedBy) {
      const depTask = this.tasks.get(dep)
      if (depTask && !depTask.blocks.includes(id)) {
        this.tasks.set(dep, { ...depTask, blocks: [...depTask.blocks, id] })
      }
    }

    this.emit({ type: EVENTS.TASK_BLOCKED, taskID: id, timestamp: Date.now(), data: { blockedBy } })

    return this.tasks.get(id)
  }

  unblock(id: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    const blockedBy = task.blockedBy
    this.update(id, { blockedBy: [], status: "pending" })

    for (const dep of blockedBy) {
      const depTask = this.tasks.get(dep)
      if (depTask) {
        const newBlocks = depTask.blocks.filter((b) => b !== id)
        this.tasks.set(dep, { ...depTask, blocks: newBlocks })
      }
    }

    this.emit({ type: EVENTS.TASK_UNBLOCKED, taskID: id, timestamp: Date.now(), data: { wasBlockedBy: blockedBy } })

    return this.tasks.get(id)
  }

  start(id: string): TaskSummary | undefined {
    return this.update(id, { status: "running", progress: 0, summary: "Task started" })
  }

  complete(id: string, result?: any, summaryText?: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    this.update(id, { status: "completed", progress: 100, summary: summaryText || "Task completed", result })

    this.emit({ type: EVENTS.TASK_COMPLETED, taskID: id, timestamp: Date.now(), data: { result } })

    return this.tasks.get(id)
  }

  error(id: string, errorMsg: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    this.update(id, { status: "error", error: errorMsg, summary: `Error: ${errorMsg}` })

    this.emit({ type: EVENTS.TASK_ERROR, taskID: id, timestamp: Date.now(), data: { error: errorMsg } })

    return this.tasks.get(id)
  }

  pause(id: string, checkpoint?: any): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    this.update(id, { status: "paused", checkpoint, summary: "Task paused" })

    this.emit({ type: EVENTS.TASK_PAUSED, taskID: id, timestamp: Date.now(), data: { checkpoint } })

    return this.tasks.get(id)
  }

  resume(id: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    this.update(id, { status: "running", summary: "Task resumed" })

    this.emit({ type: EVENTS.TASK_RESUMED, taskID: id, timestamp: Date.now() })

    return this.tasks.get(id)
  }

  cancel(id: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    this.update(id, { status: "cancelled", summary: "Task cancelled" })

    this.emit({ type: EVENTS.TASK_CANCELLED, taskID: id, timestamp: Date.now() })

    return this.tasks.get(id)
  }

  get(id: string): TaskSummary | undefined {
    return this.tasks.get(id)
  }

  getAll(): TaskSummary[] {
    return Array.from(this.tasks.values())
  }

  getByStatus(status: TaskStatus): TaskSummary[] {
    return this.getAll().filter((t) => t.status === status)
  }

  getCurrentTask(): TaskSummary | undefined {
    return this.getAll().find((t) => t.status === "running")
  }

  getDependents(id: string): TaskSummary[] {
    const task = this.tasks.get(id)
    if (!task) return []
    return this.getAll().filter((t) => t.blockedBy.includes(id))
  }

  getDependentsNotDone(id: string): TaskSummary[] {
    return this.getDependents(id).filter((t) => t.status !== "completed")
  }

  allDone(ids: string[]): boolean {
    return ids.every((id) => {
      const task = this.tasks.get(id)
      return task?.status === "completed"
    })
  }

  stats(): { pending: number; running: number; completed: number; error: number; blocked: number; total: number } {
    const all = this.getAll()
    return {
      pending: all.filter((t) => t.status === "pending").length,
      running: all.filter((t) => t.status === "running").length,
      completed: all.filter((t) => t.status === "completed").length,
      error: all.filter((t) => t.status === "error").length,
      blocked: all.filter((t) => t.status === "blocked").length,
      total: all.length,
    }
  }

  isEmpty(): boolean {
    return this.tasks.size === 0
  }

  hasPendingTasks(): boolean {
    return this.getAll().some((t) => t.status === "pending" || t.status === "blocked")
  }

  on<T extends EventType>(type: T, callback: (event: TaskEvent & { type: T }) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(callback as any)

    return () => {
      this.listeners.get(type)?.delete(callback as any)
    }
  }

  private emit(event: TaskEvent): void {
    const listeners = this.listeners.get(event.type as EventType)
    if (listeners) {
      for (const callback of listeners) {
        callback(event as any)
      }
    }
  }
}
