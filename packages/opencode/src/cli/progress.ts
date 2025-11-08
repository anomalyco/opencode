/**
 * Advanced progress indicators and status updates
 */

import { EOL } from "os"
import { UI } from "./ui"
import { RichUI } from "./rich-ui"

export namespace Progress {
  /**
   * Spinner for indeterminate progress
   */
  export class Spinner {
    private frame = 0
    private interval?: NodeJS.Timeout
    private message: string
    private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    constructor(message: string = "Loading") {
      this.message = message
    }

    start(): void {
      this.frame = 0
      this.render()
      this.interval = setInterval(() => {
        this.frame = (this.frame + 1) % this.frames.length
        this.render()
      }, 80)
    }

    update(message: string): void {
      this.message = message
      this.render()
    }

    private render(): void {
      const frame = this.frames[this.frame]
      const line = `${UI.Style.TEXT_HIGHLIGHT}${frame}${UI.Style.TEXT_NORMAL} ${this.message}`

      // Clear line and rewrite
      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line)
      }
    }

    succeed(message?: string): void {
      this.stop()
      const msg = message || this.message
      const line = `${UI.Style.TEXT_SUCCESS_BOLD}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} ${msg}`
      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line + EOL)
      } else {
        UI.println(line)
      }
    }

    fail(message?: string): void {
      this.stop()
      const msg = message || this.message
      const line = `${UI.Style.TEXT_DANGER_BOLD}${RichUI.Icons.error}${UI.Style.TEXT_NORMAL} ${msg}`
      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line + EOL)
      } else {
        UI.println(line)
      }
    }

    warn(message?: string): void {
      this.stop()
      const msg = message || this.message
      const line = `${UI.Style.TEXT_WARNING_BOLD}${RichUI.Icons.warning}${UI.Style.TEXT_NORMAL} ${msg}`
      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line + EOL)
      } else {
        UI.println(line)
      }
    }

    info(message?: string): void {
      this.stop()
      const msg = message || this.message
      const line = `${UI.Style.TEXT_INFO_BOLD}${RichUI.Icons.info}${UI.Style.TEXT_NORMAL} ${msg}`
      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line + EOL)
      } else {
        UI.println(line)
      }
    }

    stop(): void {
      if (this.interval) {
        clearInterval(this.interval)
        this.interval = undefined
      }
    }
  }

  /**
   * Progress bar for determinate progress
   */
  export class ProgressBar {
    private current: number = 0
    private readonly total: number
    private readonly width: number
    private message: string
    private startTime: number = Date.now()

    constructor(total: number, options: { message?: string; width?: number } = {}) {
      this.total = total
      this.message = options.message || "Progress"
      this.width = options.width || 40
    }

    start(): void {
      this.startTime = Date.now()
      this.render()
    }

    update(current: number, message?: string): void {
      this.current = Math.min(current, this.total)
      if (message) this.message = message
      this.render()
    }

    increment(amount: number = 1, message?: string): void {
      this.update(this.current + amount, message)
    }

    private render(): void {
      const percentage = (this.current / this.total) * 100
      const filled = Math.floor((percentage / 100) * this.width)
      const empty = this.width - filled

      const bar = "█".repeat(filled) + "░".repeat(empty)
      const pct = `${percentage.toFixed(1)}%`.padStart(6)

      // Calculate ETA
      const elapsed = Date.now() - this.startTime
      const rate = this.current / elapsed
      const remaining = (this.total - this.current) / rate
      const eta = this.current > 0 && this.current < this.total ? ` ETA: ${RichUI.formatDuration(remaining)}` : ""

      const line = `${UI.Style.TEXT_HIGHLIGHT}${bar}${UI.Style.TEXT_NORMAL} ${UI.Style.TEXT_DIM}${pct}${UI.Style.TEXT_NORMAL} ${this.message}${UI.Style.TEXT_DIM}${eta}${UI.Style.TEXT_NORMAL}`

      if (process.stderr.isTTY) {
        Bun.stderr.write("\r\x1b[K" + line)
      }
    }

    complete(message?: string): void {
      this.current = this.total
      this.message = message || this.message
      this.render()
      if (process.stderr.isTTY) {
        Bun.stderr.write(EOL)
      } else {
        UI.println()
      }
    }
  }

  /**
   * Multi-step progress tracker
   */
  export class Steps {
    private current: number = 0
    private readonly steps: Array<{ name: string; status: "pending" | "active" | "completed" | "failed" }>
    private startTime: number = Date.now()

    constructor(steps: string[]) {
      this.steps = steps.map((name) => ({ name, status: "pending" as const }))
    }

    start(): void {
      this.startTime = Date.now()
      if (this.steps.length > 0) {
        this.steps[0].status = "active"
      }
      this.render()
    }

    next(success: boolean = true): void {
      if (this.current < this.steps.length) {
        this.steps[this.current].status = success ? "completed" : "failed"
        this.current++
        if (this.current < this.steps.length) {
          this.steps[this.current].status = "active"
        }
        this.render()
      }
    }

    fail(message?: string): void {
      if (this.current < this.steps.length) {
        this.steps[this.current].status = "failed"
        if (message) {
          this.steps[this.current].name = message
        }
        this.render()
      }
    }

    private render(): void {
      if (process.stderr.isTTY) {
        // Clear previous output
        Bun.stderr.write("\x1b[" + this.steps.length + "A")
        Bun.stderr.write("\r\x1b[J")
      }

      for (const step of this.steps) {
        let icon: string
        let color: string

        switch (step.status) {
          case "completed":
            icon = RichUI.Icons.success
            color = UI.Style.TEXT_SUCCESS_BOLD
            break
          case "failed":
            icon = RichUI.Icons.error
            color = UI.Style.TEXT_DANGER_BOLD
            break
          case "active":
            icon = RichUI.Icons.arrow
            color = UI.Style.TEXT_HIGHLIGHT_BOLD
            break
          default:
            icon = RichUI.Icons.dot
            color = UI.Style.TEXT_DIM
        }

        UI.println(`${color}${icon}${UI.Style.TEXT_NORMAL} ${step.name}`)
      }

      // Move cursor back up if TTY
      if (process.stderr.isTTY && this.current < this.steps.length) {
        Bun.stderr.write("\x1b[" + this.steps.length + "A")
      }
    }

    complete(): void {
      const elapsed = Date.now() - this.startTime
      if (process.stderr.isTTY) {
        Bun.stderr.write("\x1b[" + this.steps.length + "B")
      }
      UI.println()
      UI.println(
        `${UI.Style.TEXT_SUCCESS_BOLD}${RichUI.Icons.success}${UI.Style.TEXT_NORMAL} Completed in ${RichUI.formatDuration(elapsed)}`,
      )
    }
  }

  /**
   * Task list with real-time updates
   */
  export class TaskList {
    private tasks: Array<{
      name: string
      status: "pending" | "running" | "completed" | "failed"
      startTime?: number
      endTime?: number
    }> = []

    add(name: string): void {
      this.tasks.push({ name, status: "pending" })
      this.render()
    }

    start(index: number): void {
      if (index >= 0 && index < this.tasks.length) {
        this.tasks[index].status = "running"
        this.tasks[index].startTime = Date.now()
        this.render()
      }
    }

    complete(index: number, success: boolean = true): void {
      if (index >= 0 && index < this.tasks.length) {
        this.tasks[index].status = success ? "completed" : "failed"
        this.tasks[index].endTime = Date.now()
        this.render()
      }
    }

    private render(): void {
      if (!process.stderr.isTTY) {
        return
      }

      // Move cursor to beginning and clear
      Bun.stderr.write("\r\x1b[J")

      for (const task of this.tasks) {
        let icon: string
        let color: string
        let duration = ""

        switch (task.status) {
          case "completed":
            icon = RichUI.Icons.success
            color = UI.Style.TEXT_SUCCESS
            if (task.startTime && task.endTime) {
              duration = ` ${UI.Style.TEXT_DIM}(${RichUI.formatDuration(task.endTime - task.startTime)})`
            }
            break
          case "failed":
            icon = RichUI.Icons.error
            color = UI.Style.TEXT_DANGER
            break
          case "running":
            icon = RichUI.Icons.loading[0]
            color = UI.Style.TEXT_HIGHLIGHT
            break
          default:
            icon = RichUI.Icons.dot
            color = UI.Style.TEXT_DIM
        }

        UI.println(`${color}${icon}${UI.Style.TEXT_NORMAL} ${task.name}${duration}${UI.Style.TEXT_NORMAL}`)
      }
    }
  }

  /**
   * Simple loading indicator
   */
  export async function withSpinner<T>(
    promise: Promise<T>,
    message: string,
  ): Promise<T> {
    const spinner = new Spinner(message)
    spinner.start()

    try {
      const result = await promise
      spinner.succeed()
      return result
    } catch (error) {
      spinner.fail()
      throw error
    }
  }

  /**
   * Execute tasks with progress tracking
   */
  export async function withProgress<T>(
    tasks: Array<{ name: string; fn: () => Promise<T> }>,
  ): Promise<T[]> {
    const steps = new Steps(tasks.map((t) => t.name))
    steps.start()

    const results: T[] = []

    for (const task of tasks) {
      try {
        const result = await task.fn()
        results.push(result)
        steps.next(true)
      } catch (error) {
        steps.fail(error instanceof Error ? error.message : "Failed")
        throw error
      }
    }

    steps.complete()
    return results
  }
}
