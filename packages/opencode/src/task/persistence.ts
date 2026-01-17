import fs from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import type { TaskInfo, TaskStatus } from "./events"

const log = Log.create({ service: "task-persistence" })

/**
 * Persistence schema for task state
 */
export interface PersistedTask {
  id: string
  pid: number
  command: string
  startTime: number
  status: TaskStatus
  exitCode?: number
  workdir: string
  description?: string
  logFile: string
  reconnectable: boolean
}

export namespace TaskPersistence {
  /**
   * Get the tasks directory for a project
   */
  export function getTasksDir(projectDir: string): string {
    return path.join(projectDir, ".opencode", "tasks")
  }

  /**
   * Get the state file path for a task
   */
  export function getStateFile(projectDir: string, taskId: string): string {
    return path.join(getTasksDir(projectDir), `${taskId}.json`)
  }

  /**
   * Get the log file path for a task
   */
  export function getLogFile(projectDir: string, taskId: string): string {
    return path.join(getTasksDir(projectDir), `${taskId}.log`)
  }

  /**
   * Ensure the tasks directory exists
   */
  export async function ensureDir(projectDir: string): Promise<void> {
    const dir = getTasksDir(projectDir)
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Save task state to disk (atomic write via temp file + rename)
   */
  export async function save(projectDir: string, task: TaskInfo): Promise<void> {
    await ensureDir(projectDir)
    const stateFile = getStateFile(projectDir, task.id)
    const tempFile = stateFile + ".tmp"

    const persisted: PersistedTask = {
      id: task.id,
      pid: task.pid,
      command: task.command,
      startTime: task.startTime,
      status: task.status,
      exitCode: task.exitCode,
      workdir: task.workdir,
      description: task.description,
      logFile: task.logFile,
      reconnectable: task.reconnectable,
    }

    try {
      await fs.writeFile(tempFile, JSON.stringify(persisted, null, 2))
      await fs.rename(tempFile, stateFile)
      log.debug("saved task state", { taskId: task.id, stateFile })
    } catch (err) {
      log.error("failed to save task state", { taskId: task.id, error: err })
      // Clean up temp file if rename failed
      await fs.unlink(tempFile).catch(() => {})
      throw err
    }
  }

  /**
   * Load a single task state from disk
   */
  export async function load(projectDir: string, taskId: string): Promise<PersistedTask | undefined> {
    const stateFile = getStateFile(projectDir, taskId)
    try {
      const content = await fs.readFile(stateFile, "utf-8")
      return JSON.parse(content) as PersistedTask
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.error("failed to load task state", { taskId, error: err })
      }
      return undefined
    }
  }

  /**
   * Load all persisted tasks for a project
   */
  export async function loadAll(projectDir: string): Promise<PersistedTask[]> {
    const dir = getTasksDir(projectDir)
    if (!(await Filesystem.exists(dir))) {
      return []
    }

    const files = await fs.readdir(dir)
    const tasks: PersistedTask[] = []

    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const taskId = file.replace(".json", "")
      const task = await load(projectDir, taskId)
      if (task) {
        tasks.push(task)
      }
    }

    return tasks
  }

  /**
   * Delete task state and log files
   */
  export async function remove(projectDir: string, taskId: string): Promise<void> {
    const stateFile = getStateFile(projectDir, taskId)
    const logFile = getLogFile(projectDir, taskId)

    await Promise.all([
      fs.unlink(stateFile).catch(() => {}),
      fs.unlink(logFile).catch(() => {}),
    ])
    log.debug("removed task files", { taskId })
  }

  /**
   * Append output to a task's log file
   */
  export async function appendLog(projectDir: string, taskId: string, data: string): Promise<void> {
    await ensureDir(projectDir)
    const logFile = getLogFile(projectDir, taskId)
    await fs.appendFile(logFile, data)
  }

  /**
   * Read all output from a task's log file
   */
  export async function readLog(projectDir: string, taskId: string): Promise<string> {
    const logFile = getLogFile(projectDir, taskId)
    try {
      return await fs.readFile(logFile, "utf-8")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.error("failed to read task log", { taskId, error: err })
      }
      return ""
    }
  }

  /**
   * Read the last N lines from a task's log file
   */
  export async function tailLog(projectDir: string, taskId: string, lines: number): Promise<string> {
    const content = await readLog(projectDir, taskId)
    if (!content) return ""

    // Split and filter out empty strings from trailing newlines
    const allLines = content.split("\n").filter((line) => line.length > 0)
    const lastLines = allLines.slice(-lines)
    return lastLines.join("\n")
  }

  /**
   * Check if a process is still running by PID
   */
  export function isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 doesn't actually send a signal, but checks if process exists
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
