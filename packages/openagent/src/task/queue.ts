/**
 * Task Queue
 *
 * Priority queue that manages task ordering and concurrency.
 * Tasks are processed in priority order (critical → high → normal → low).
 * Supports concurrent processing up to a configurable maximum.
 */

import type { Task, TaskPriority } from "./task.ts"
import { comparePriority } from "./task.ts"

export interface QueueOptions {
  /** Maximum number of tasks running concurrently */
  concurrency?: number
}

type QueueEntry = {
  task: Task
  resolve: (result: string) => void
  reject: (error: Error) => void
}

/**
 * Priority-based task queue with concurrency control.
 * The orchestrator enqueues tasks here; a worker loop dequeues and executes them.
 */
export class TaskQueue {
  private queue: QueueEntry[] = []
  private running = 0
  private concurrency: number
  private processor?: (task: Task) => Promise<string>
  private draining = false

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 4
  }

  /**
   * Set the function that processes each task.
   * Called once during orchestrator setup.
   */
  setProcessor(fn: (task: Task) => Promise<string>) {
    this.processor = fn
  }

  /**
   * Add a task to the queue. Returns a promise that resolves when
   * the task completes (with its result) or rejects on failure.
   */
  enqueue(task: Task): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      // Keep queue sorted by priority (highest first)
      this.queue.sort((a, b) => comparePriority(a.task.priority, b.task.priority))
      this.drain()
    })
  }

  /**
   * Cancel a pending task (if it hasn't started yet).
   */
  cancel(taskId: string): boolean {
    const idx = this.queue.findIndex((e) => e.task.id === taskId)
    if (idx === -1) return false
    const [entry] = this.queue.splice(idx, 1)
    entry.reject(new Error(`Task ${taskId} was cancelled`))
    return true
  }

  /** Current queue depth */
  get depth() {
    return this.queue.length
  }

  /** Number of tasks currently executing */
  get active() {
    return this.running
  }

  /** Queue + running stats */
  stats() {
    const byPriority: Record<TaskPriority, number> = { low: 0, normal: 0, high: 0, critical: 0 }
    for (const e of this.queue) byPriority[e.task.priority]++
    return { queued: this.queue.length, running: this.running, byPriority }
  }

  private drain() {
    if (this.draining) return
    this.draining = true
    Promise.resolve().then(() => {
      this.draining = false
      this.tick()
    })
  }

  private tick() {
    if (!this.processor) return
    while (this.running < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!
      this.running++
      this.processor(entry.task)
        .then(entry.resolve)
        .catch(entry.reject)
        .finally(() => {
          this.running--
          this.tick()
        })
    }
  }
}
