// Background Validation Worker - runs lint/typecheck/tests on file changes in isolated thread
import { Rpc } from "@/util/rpc"

import { $ } from "bun"
import { appendFile } from "fs/promises"

interface ValidationTask {
  id: string
  files: string[]
  commands: string[]
  timestamp: number
  status: "pending" | "running" | "completed" | "error"
  results?: ValidationResult[]
}

interface ValidationResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

interface ValidationState {
  queue: ValidationTask[]
  running: ValidationTask | null
  lastResults: ValidationResult[]
  stats: {
    totalRuns: number
    successRate: number
    avgDuration: number
  }
}

let config: {
  serverUrl: string
  sessionID: string
  commands: string[]
  debounceMs: number
  include: string[]
  exclude: string[]
}

let state: ValidationState = {
  queue: [],
  running: null,
  lastResults: [],
  stats: {
    totalRuns: 0,
    successRate: 0,
    avgDuration: 0,
  },
}

// Log to file since console.log won't show in TUI
async function logWorker(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-validation-worker.log", `[${timestamp}] ${msg}\n`)
}

function broadcastState() {
  postMessage(
    JSON.stringify({
      type: "validation.state.update",
      state,
    }),
  )
}

function shouldValidateFile(filePath: string): boolean {
  // Skip if file doesn't match include patterns
  if (config.include.length > 0) {
    const included = config.include.some((pattern) => filePath.match(new RegExp(pattern.replace(/\*/g, ".*"))))
    if (!included) return false
  }

  // Skip if file matches exclude patterns
  if (config.exclude.length > 0) {
    const excluded = config.exclude.some((pattern) => filePath.match(new RegExp(pattern.replace(/\*/g, ".*"))))
    if (excluded) return false
  }

  // Default include patterns for performance/quality
  const defaultIncludes = [
    /\.(ts|tsx|js|jsx)$/, // TypeScript/JavaScript files
    /\.(json|jsonc)$/, // Config files
    /package\.json$/, // Package changes
    /tsconfig.*\.json$/, // TypeScript config
    /\.eslintrc/, // ESLint config
  ]

  return defaultIncludes.some((pattern) => pattern.test(filePath))
}

async function executeValidation(task: ValidationTask): Promise<ValidationResult[]> {
  await logWorker(`Executing validation task ${task.id} with ${task.commands.length} commands`)
  const results: ValidationResult[] = []

  for (const command of task.commands) {
    const startTime = Date.now()
    try {
      await logWorker(`Running: ${command}`)
      const result = await $`sh -c ${command}`.quiet().nothrow()

      const duration = Date.now() - startTime
      const validationResult: ValidationResult = {
        command,
        exitCode: result.exitCode,
        stdout: result.stdout?.toString() || "",
        stderr: result.stderr?.toString() || "",
        duration,
      }

      results.push(validationResult)
      await logWorker(`Command completed: exit ${result.exitCode}, duration ${duration}ms`)

      // Stop on first failure for faster feedback
      if (result.exitCode !== 0) {
        await logWorker(`Validation failed on command: ${command}`)
        break
      }
    } catch (error) {
      const duration = Date.now() - startTime
      results.push({
        command,
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        duration,
      })
      await logWorker(`Command error: ${error}`)
      break
    }
  }

  return results
}

async function processQueue() {
  if (state.running || state.queue.length === 0) return

  const task = state.queue.shift()!
  state.running = task
  task.status = "running"
  broadcastState()

  try {
    const results = await executeValidation(task)
    task.results = results
    task.status = results.every((r) => r.exitCode === 0) ? "completed" : "error"

    state.lastResults = results
    state.stats.totalRuns++
    state.stats.successRate =
      (state.stats.successRate * (state.stats.totalRuns - 1) + (task.status === "completed" ? 1 : 0)) /
      state.stats.totalRuns

    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length
    state.stats.avgDuration =
      (state.stats.avgDuration * (state.stats.totalRuns - 1) + avgDuration) / state.stats.totalRuns

    await logWorker(`Task ${task.id} ${task.status}, results: ${results.length}`)
  } catch (error) {
    task.status = "error"
    await logWorker(`Task ${task.id} failed: ${error}`)
  } finally {
    state.running = null
    broadcastState()

    // Continue processing queue
    setTimeout(processQueue, 100)
  }
}

let debounceTimer: Timer | null = null

function enqueueValidation(files: string[]) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    const validFiles = files.filter(shouldValidateFile)
    if (validFiles.length === 0) return

    const task: ValidationTask = {
      id: `validation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      files: validFiles,
      commands: config.commands,
      timestamp: Date.now(),
      status: "pending",
    }

    // Remove any pending tasks for similar files to avoid spam
    state.queue = state.queue.filter((existingTask) => {
      const overlap = existingTask.files.some((f) => validFiles.includes(f))
      return !overlap || existingTask.status !== "pending"
    })

    state.queue.push(task)
    broadcastState()
    processQueue()
  }, config.debounceMs)
}

// RPC handlers
export const rpc = {
  async init(cfg: typeof config) {
    config = cfg
    await logWorker(`Validation worker initialized for session: ${cfg.sessionID}`)
    await logWorker(`Commands: ${cfg.commands.join(", ")}`)
    await logWorker(`Debounce: ${cfg.debounceMs}ms`)
    return { ready: true, state }
  },

  async getState() {
    return state
  },

  async enqueue(files: string[]) {
    await logWorker(`Enqueue validation for ${files.length} files`)
    enqueueValidation(files)
    return { queued: true, files: files.filter(shouldValidateFile) }
  },

  async clearQueue() {
    state.queue = []
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    broadcastState()
    return { cleared: true }
  },

  async runNow(files?: string[]) {
    if (files) {
      enqueueValidation(files)
    }
    // Clear debounce and process immediately
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    await processQueue()
    return { running: true }
  },

  async shutdown() {
    await logWorker("Validation worker shutting down")
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  },
}

Rpc.listen(rpc)
