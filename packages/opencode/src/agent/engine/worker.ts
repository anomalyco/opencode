import type { L1Snapshot } from "./checkpoint"

export interface WorkerTask {
  taskId: string
  nodeId: string
  capabilityId: string
  inputs: Record<string, unknown>
  contextSnapshot: L1Snapshot
}

export interface WorkerResult {
  taskId: string
  nodeId: string
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
  tokenCost: number
}

export type WorkerHandler = (task: WorkerTask) => Promise<WorkerResult>

export interface WorkerPoolMetrics {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  timedOutTasks: number
  avgDurationMs: number
  peakConcurrency: number
  currentConcurrency: number
}

export class StatelessWorkerPool {
  private handlers = new Map<string, WorkerHandler>()
  private maxParallel: number
  private defaultTimeoutMs: number
  private activeCount = 0
  private peakActive = 0
  private totalTasks = 0
  private completedTasks = 0
  private failedTasks = 0
  private timedOutTasks = 0
  private totalDurationMs = 0
  private shutdownFlag = false

  constructor(maxParallel: number = 3, defaultTimeoutMs: number = 60000) {
    this.maxParallel = maxParallel
    this.defaultTimeoutMs = defaultTimeoutMs
  }

  registerHandler(capabilityId: string, handler: WorkerHandler): void {
    this.handlers.set(capabilityId, handler)
  }

  unregisterHandler(capabilityId: string): boolean {
    return this.handlers.delete(capabilityId)
  }

  getHandlerCount(): number {
    return this.handlers.size
  }

  async executeTask(task: WorkerTask, timeoutMs?: number): Promise<WorkerResult> {
    if (this.shutdownFlag) {
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: "Worker pool is shutting down",
        durationMs: 0,
        tokenCost: 0,
      }
    }

    const handler = this.handlers.get(task.capabilityId)
    if (!handler) {
      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: `No handler registered for capability: ${task.capabilityId}`,
        durationMs: 0,
        tokenCost: 0,
      }
    }

    this.activeCount++
    this.peakActive = Math.max(this.peakActive, this.activeCount)
    this.totalTasks++

    const startTime = Date.now()
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs

    try {
      const result = await this.executeWithTimeout(handler, task, effectiveTimeout)
      const duration = Date.now() - startTime
      result.durationMs = duration

      this.totalDurationMs += duration
      if (result.success) {
        this.completedTasks++
      } else {
        this.failedTasks++
      }

      return result
    } catch (err) {
      const duration = Date.now() - startTime
      const isTimeout = err instanceof TimeoutError
      if (isTimeout) this.timedOutTasks++
      else this.failedTasks++

      return {
        taskId: task.taskId,
        nodeId: task.nodeId,
        success: false,
        error: isTimeout
          ? `Task timed out after ${effectiveTimeout}ms`
          : err instanceof Error ? err.message : String(err),
        durationMs: duration,
        tokenCost: 0,
      }
    } finally {
      this.activeCount--
    }
  }

  private async executeWithTimeout(
    handler: WorkerHandler,
    task: WorkerTask,
    timeoutMs: number,
  ): Promise<WorkerResult> {
    if (timeoutMs <= 0) return handler(task)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs)

    try {
      const signal = controller.signal
      const resultPromise = handler(task)

      // Race handler against abort signal
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new TimeoutError(timeoutMs))
        }, { once: true })

        resultPromise.then(resolve).catch(reject)
      })

      return result
    } catch (err) {
      if (err instanceof TimeoutError) throw err
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async executeTasksInParallel(
    tasks: WorkerTask[],
    options?: { timeoutMs?: number; stopOnFailure?: boolean },
  ): Promise<WorkerResult[]> {
    const timeoutMs = options?.timeoutMs
    const results: WorkerResult[] = new Array(tasks.length)

    // Use a semaphore to limit concurrency
    const semaphore = new ConcurrencySemaphore(this.maxParallel)
    const promises = tasks.map(async (task, index) => {
      await semaphore.acquire()
      try {
        results[index] = await this.executeTask(task, timeoutMs)
        if (options?.stopOnFailure && !results[index].success) {
          // Mark remaining pending slots as cancelled
          semaphore.cancelAll()
        }
      } finally {
        semaphore.release()
      }
    })

    await Promise.allSettled(promises)
    return results.filter((r): r is WorkerResult => r !== undefined)
  }

  async executeTasksSequential(
    tasks: WorkerTask[],
    options?: { timeoutMs?: number },
  ): Promise<WorkerResult[]> {
    const results: WorkerResult[] = []
    for (const task of tasks) {
      const result = await this.executeTask(task, options?.timeoutMs)
      results.push(result)
      if (!result.success) break
    }
    return results
  }

  getMetrics(): WorkerPoolMetrics {
    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      timedOutTasks: this.timedOutTasks,
      avgDurationMs: this.completedTasks > 0
        ? Math.round(this.totalDurationMs / this.completedTasks)
        : 0,
      peakConcurrency: this.peakActive,
      currentConcurrency: this.activeCount,
    }
  }

  async shutdown(gracePeriodMs: number = 5000): Promise<void> {
    this.shutdownFlag = true

    // Wait for active tasks to drain
    const start = Date.now()
    while (this.activeCount > 0 && Date.now() - start < gracePeriodMs) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  reset(): void {
    this.activeCount = 0
    this.peakActive = 0
    this.totalTasks = 0
    this.completedTasks = 0
    this.failedTasks = 0
    this.timedOutTasks = 0
    this.totalDurationMs = 0
    this.shutdownFlag = false
  }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`)
    this.name = "TimeoutError"
  }
}

class ConcurrencySemaphore {
  private permits: number
  private waiters: Array<() => void> = []
  private cancelled = false

  constructor(maxConcurrent: number) {
    this.permits = maxConcurrent
  }

  async acquire(): Promise<void> {
    if (this.cancelled) return
    if (this.permits > 0) {
      this.permits--
      return
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter()
    } else {
      this.permits++
    }
  }

  cancelAll(): void {
    this.cancelled = true
    for (const waiter of this.waiters) {
      waiter()
    }
    this.waiters = []
  }
}

export * as Worker from "./worker"
