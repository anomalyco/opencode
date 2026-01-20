import z from "zod"
import { spawn, type ChildProcess } from "child_process"
import { randomBytes } from "crypto"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { Shell } from "../shell/shell"
import { TaskPersistence } from "./persistence"
import { TaskEvent, type TaskInfo, type TaskStatus } from "./events"

export { TaskEvent, type TaskInfo, type TaskStatus } from "./events"

const log = Log.create({ service: "task-manager" })

/**
 * Options for creating a background task
 */
export interface CreateTaskOptions {
  command: string
  workdir?: string
  description?: string
  reconnectable?: boolean
}

/**
 * Internal task state with process handle
 */
interface ManagedTask extends TaskInfo {
  process?: ChildProcess
  output: string[]
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(4).toString("hex")
  return `task_${timestamp}_${random}`
}

/**
 * Create instance-scoped task state
 */
const state = Instance.state(
  () => {
    const tasks = new Map<string, ManagedTask>()
    let initialized = false
    return { tasks, initialized }
  },
  async (entry) => {
    // Cleanup: don't kill processes on dispose, just clear references
    // (allows tasks to survive instance disposal if reconnectable)
    for (const task of entry.tasks.values()) {
      task.process = undefined
    }
    entry.tasks.clear()
  },
)

export namespace TaskManager {
  /**
   * Initialize task manager, loading persisted tasks and reconnecting to running processes
   */
  export async function init(): Promise<void> {
    const s = state()
    if (s.initialized) return
    s.initialized = true

    let persisted = await TaskPersistence.loadAll(Instance.directory)
    log.info("loading persisted tasks", { count: persisted.length, directory: Instance.directory })

    // Also try loading persisted tasks from the current process cwd as a fallback.
    // This helps when a task was created or migrated while the server's Instance.directory
    // differed from the process working directory used when launching the task.
    try {
      const cwd = process.cwd()
      if (cwd && cwd !== Instance.directory) {
        const cwdPersisted = await TaskPersistence.loadAll(cwd)
        log.info("loading persisted tasks from cwd fallback", { count: cwdPersisted.length, cwd })
        // Merge without duplicating IDs
        for (const p of cwdPersisted) {
          if (!persisted.find((x) => x.id === p.id)) persisted.push(p)
        }
      }
    } catch (err) {
      log.debug("failed to load persisted tasks from cwd fallback", { error: String(err) })
    }

    for (const saved of persisted) {
      try {
        const stillRunning = TaskPersistence.isProcessRunning(saved.pid)

        const task: ManagedTask = {
          ...saved,
          output: [],
          process: undefined,
        }

        // If process is still running and task was marked as running, keep it
        if (stillRunning && saved.status === "running" && saved.reconnectable) {
          log.info("reconnected to running task", { taskId: saved.id, pid: saved.pid })
          s.tasks.set(saved.id, task)
          try {
            await Bus.publish(TaskEvent.Reconnected, {
              id: saved.id,
              stillRunning: true,
            })
          } catch (err) {
            log.error("failed to publish reconnected event", { taskId: saved.id, error: String(err) })
          }
        } else if (saved.status === "running") {
          // Process died while we weren't watching - mark as failed
          task.status = "failed"
          try {
            await TaskPersistence.save(Instance.directory, task)
          } catch (err) {
            log.error("failed to save task state during init", { taskId: saved.id, error: String(err) })
          }
          s.tasks.set(saved.id, task)
          try {
            await Bus.publish(TaskEvent.Reconnected, {
              id: saved.id,
              stillRunning: false,
            })
          } catch (err) {
            log.error("failed to publish reconnected event (dead)", { taskId: saved.id, error: String(err) })
          }
        } else {
          // Already completed/failed, just load it
          s.tasks.set(saved.id, task)
        }
      } catch (err) {
        log.error("error while initializing persisted task", { id: saved.id, error: String(err) })
      }
    }
  }

  /**
   * Create and start a new background task
   */
  export async function create(opts: CreateTaskOptions): Promise<TaskInfo> {
    await init()

    const taskId = generateTaskId()
    const directory = Instance.directory // Capture directory for use in async callbacks
    const workdir = opts.workdir || directory
    const logFile = TaskPersistence.getLogFile(directory, taskId)
    const shell = Shell.acceptable()

    log.info("creating background task", {
      taskId,
      command: opts.command,
      workdir,
    })

    let proc: ChildProcess
    try {
      proc = spawn(opts.command, {
        shell,
        cwd: workdir,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })
    } catch (err) {
      log.error("spawn failed", { taskId, command: opts.command, error: String(err) })
      throw err
    }

    const task: ManagedTask = {
      id: taskId,
      pid: proc.pid!,
      command: opts.command,
      startTime: Date.now(),
      status: "running",
      workdir,
      description: opts.description,
      logFile,
      reconnectable: opts.reconnectable ?? true,
      process: proc,
      output: [],
    }

    state().tasks.set(taskId, task)

    // Save initial state
    try {
      await TaskPersistence.save(directory, task)
    } catch (err) {
      log.error("failed to save initial task state", { taskId, error: String(err) })
    }

    // Handle stdout - wrapped in Instance.provide for async context
    proc.stdout?.on("data", (chunk: Buffer) => {
      const data = chunk.toString()
      task.output.push(data)
      log.debug("task stdout chunk", { taskId, len: data.length })
      // Fire and forget - don't await to avoid blocking process
      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.appendLog(directory, taskId, data)
          } catch (err) {
            log.error("failed to append stdout to log", { taskId, error: String(err) })
          }

          try {
            await Bus.publish(TaskEvent.Output, {
              id: taskId,
              data,
              isError: false,
            })
          } catch (err) {
            log.error("failed to publish stdout output event", { taskId, error: String(err) })
          }
        },
      })
    })

    // Handle stderr - wrapped in Instance.provide for async context
    proc.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString()
      task.output.push(data)
      log.debug("task stderr chunk", { taskId, len: data.length })
      // Fire and forget - don't await to avoid blocking process
      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.appendLog(directory, taskId, data)
          } catch (err) {
            log.error("failed to append stderr to log", { taskId, error: String(err) })
          }

          try {
            await Bus.publish(TaskEvent.Output, {
              id: taskId,
              data,
              isError: true,
            })
          } catch (err) {
            log.error("failed to publish stderr output event", { taskId, error: String(err) })
          }
        },
      })
    })

    // Handle exit - wrapped in Instance.provide for async context
    proc.on("exit", (code) => {
      task.exitCode = code ?? undefined
      task.status = code === 0 ? "completed" : "failed"
      task.process = undefined

      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.save(directory, task)
          } catch (err) {
            log.error("failed to save task state on exit", { taskId, exitCode: code, error: String(err) })
          }

          try {
            await Bus.publish(TaskEvent.Completed, {
              id: taskId,
              exitCode: code,
              status: task.status,
            })
          } catch (err) {
            log.error("failed to publish completed event", { taskId, exitCode: code, error: String(err) })
          }

          log.info("background task completed", {
            taskId,
            exitCode: code,
            status: task.status,
          })
        },
      })
    })

    // Handle errors - wrapped in Instance.provide for async context
    proc.once("error", (err) => {
      const errMsg = err instanceof Error ? `${err.message} ${err.stack ?? ""}` : String(err)
      log.error("background task error", { taskId, error: errMsg })
      task.status = "failed"
      task.process = undefined

      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.save(directory, task)
          } catch (e) {
            log.error("failed to save task state after error", { taskId, error: String(e) })
          }

          try {
            await Bus.publish(TaskEvent.Completed, {
              id: taskId,
              exitCode: null,
              status: "failed",
            })
          } catch (e) {
            log.error("failed to publish completed event after error", { taskId, error: String(e) })
          }
        },
      })
    })

    // Publish created event
    try {
      await Bus.publish(TaskEvent.Created, {
        info: {
          id: task.id,
          pid: task.pid,
          command: task.command,
          startTime: task.startTime,
          status: task.status,
          workdir: task.workdir,
          description: task.description,
          logFile: task.logFile,
          reconnectable: task.reconnectable,
        },
      })
    } catch (err) {
      log.error("failed to publish created event", { taskId, error: String(err) })
    }

    return {
      id: task.id,
      pid: task.pid,
      command: task.command,
      startTime: task.startTime,
      status: task.status,
      workdir: task.workdir,
      description: task.description,
      logFile: task.logFile,
      reconnectable: task.reconnectable,
    }
  }

  /**
   * List all tasks
   * @param directory Optional directory to search for tasks. If not provided, uses Instance.directory
   */
  export async function list(directory?: string): Promise<TaskInfo[]> {
    await init()

    const targetDir = directory || Instance.directory
    log.debug("list called", { directory, targetDir, instanceDir: Instance.directory })

    // Ensure we pick up any tasks that were persisted on disk by another instance
    // after init() ran (e.g. migrated foreground processes). This merges persisted
    // tasks into the in-memory state if they're missing.
    try {
      const persisted = await TaskPersistence.loadAll(targetDir)
      log.debug("loaded persisted tasks", { count: persisted.length })
      const cwd = process.cwd()
      if (cwd && cwd !== targetDir) {
        const cwdPersisted = await TaskPersistence.loadAll(cwd)
        for (const p of cwdPersisted) {
          if (!persisted.find((x) => x.id === p.id)) persisted.push(p)
        }
      }
      // Also check Instance.directory if different from targetDir
      if (Instance.directory !== targetDir && Instance.directory !== cwd) {
        const instancePersisted = await TaskPersistence.loadAll(Instance.directory)
        for (const p of instancePersisted) {
          if (!persisted.find((x) => x.id === p.id)) persisted.push(p)
        }
      }

      for (const saved of persisted) {
        if (!state().tasks.has(saved.id)) {
          const task: ManagedTask = {
            ...saved,
            output: [],
            process: undefined,
          }
          state().tasks.set(saved.id, task)
        }
      }
    } catch (err) {
      log.debug("failed to refresh tasks from disk during list", { error: String(err) })
    }

    return Array.from(state().tasks.values()).map((t) => ({
      id: t.id,
      pid: t.pid,
      command: t.command,
      startTime: t.startTime,
      status: t.status,
      exitCode: t.exitCode,
      workdir: t.workdir,
      description: t.description,
      logFile: t.logFile,
      reconnectable: t.reconnectable,
    }))
  }

  /**
   * Get a specific task by ID
   */
  export async function get(taskId: string): Promise<TaskInfo | undefined> {
    await init()
    const task = state().tasks.get(taskId)
    if (!task) return undefined

    // Check if process has exited but event hasn't fired yet
    if (task.status === "running" && task.process) {
      const exitCode = task.process.exitCode
      if (exitCode !== null) {
        // Process has exited, update status
        task.exitCode = exitCode
        task.status = exitCode === 0 ? "completed" : "failed"
        task.process = undefined
      }
    }

    return {
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
  }

  /**
   * Kill a running task
   */
  export async function kill(taskId: string): Promise<boolean> {
    await init()
    const task = state().tasks.get(taskId)
    if (!task) {
      log.warn("cannot kill unknown task", { taskId })
      return false
    }

    if (task.status !== "running") {
      log.warn("cannot kill non-running task", { taskId, status: task.status })
      return false
    }

    log.info("killing task", { taskId, pid: task.pid })

    // If we have the process handle, use Shell.killTree
    if (task.process) {
      let exited = false
      task.process.once("exit", () => {
        exited = true
      })
      await Shell.killTree(task.process, { exited: () => exited })
    } else {
      // No process handle (reconnected task), try direct kill
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(task.pid), "/f", "/t"], { stdio: "ignore" })
        } else {
          process.kill(-task.pid, "SIGTERM")
          await Bun.sleep(200)
          try {
            process.kill(-task.pid, "SIGKILL")
          } catch {
            // Process may have already exited
          }
        }
      } catch {
        // Process may have already exited
        try {
          process.kill(task.pid, "SIGTERM")
          await Bun.sleep(200)
          process.kill(task.pid, "SIGKILL")
        } catch {
          // Ignore
        }
      }
    }

    task.status = "failed"
    task.process = undefined

    try {
      await TaskPersistence.save(Instance.directory, task)
    } catch (err) {
      log.error("failed to save task state after kill", { taskId, error: String(err) })
    }

    try {
      await Bus.publish(TaskEvent.Killed, { id: taskId })
    } catch (err) {
      log.error("failed to publish killed event", { taskId, error: String(err) })
    }

    return true
  }

  /**
   * Read full output from a task
   */
  export async function read(taskId: string): Promise<string> {
    await init()

    // First check in-memory output
    const task = state().tasks.get(taskId)
    if (task && task.output.length > 0) {
      return task.output.join("")
    }

    // Fall back to log file
    return TaskPersistence.readLog(Instance.directory, taskId)
  }

  /**
   * Get last N lines of output from a task
   */
  export async function tail(taskId: string, lines: number = 50): Promise<string> {
    await init()
    return TaskPersistence.tailLog(Instance.directory, taskId, lines)
  }

  /**
   * Send input to a task's stdin
   */
  export async function input(taskId: string, data: string): Promise<boolean> {
    await init()
    const task = state().tasks.get(taskId)

    if (!task) {
      log.warn("cannot send input to unknown task", { taskId })
      return false
    }

    if (!task.process) {
      log.warn("cannot send input to task without process handle", { taskId })
      return false
    }

    if (task.status !== "running") {
      log.warn("cannot send input to non-running task", { taskId, status: task.status })
      return false
    }

    if (!task.process.stdin) {
      log.warn("task stdin not available", { taskId })
      return false
    }

    try {
      task.process.stdin.write(data)
      log.debug("sent input to task", { taskId, dataLength: data.length })
      return true
    } catch (err) {
      log.error("failed to send input to task", { taskId, error: String(err) })
      return false
    }
  }

  /**
   * Cleanup completed tasks older than maxAge milliseconds
   */
  export async function cleanup(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    await init()
    const now = Date.now()
    let removed = 0

    for (const task of state().tasks.values()) {
      if (task.status !== "running" && now - task.startTime > maxAge) {
        state().tasks.delete(task.id)
        await TaskPersistence.remove(Instance.directory, task.id)
        removed++
        log.debug("cleaned up old task", { taskId: task.id })
      }
    }

    if (removed > 0) {
      log.info("cleaned up old tasks", { count: removed })
    }

    return removed
  }

  /**
   * Remove a specific task (must be completed/failed)
   */
  export async function remove(taskId: string): Promise<boolean> {
    await init()
    const task = state().tasks.get(taskId)

    if (!task) {
      return false
    }

    if (task.status === "running") {
      log.warn("cannot remove running task", { taskId })
      return false
    }

    state().tasks.delete(taskId)
    await TaskPersistence.remove(Instance.directory, taskId)
    log.debug("removed task", { taskId })
    return true
  }

  /**
   * Options for adopting an existing process as a background task
   */
  export interface AdoptTaskOptions {
    process: ChildProcess
    command: string
    workdir?: string
    description?: string
    initialOutput?: string
    startTime?: number
  }

  /**
   * Adopt an existing running process as a background task
   * This is used when migrating a foreground bash process to background
   */
  export async function adopt(opts: AdoptTaskOptions): Promise<TaskInfo> {
    await init()

    const taskId = generateTaskId()
    const directory = Instance.directory
    const workdir = opts.workdir || directory
    const logFile = TaskPersistence.getLogFile(directory, taskId)
    const startTime = opts.startTime ?? Date.now()

    log.info("adopting process as background task", {
      taskId,
      pid: opts.process.pid,
      command: opts.command,
    })

    const task: ManagedTask = {
      id: taskId,
      pid: opts.process.pid!,
      command: opts.command,
      startTime,
      status: "running",
      workdir,
      description: opts.description,
      logFile,
      reconnectable: true,
      process: opts.process,
      output: opts.initialOutput ? [opts.initialOutput] : [],
    }

    state().tasks.set(taskId, task)

    // Fire-and-forget: Write initial output to log file (non-blocking for faster migration)
    if (opts.initialOutput) {
      const initialOutput = opts.initialOutput
      void (async () => {
        try {
          await TaskPersistence.appendLog(directory, taskId, initialOutput)
        } catch (err) {
          log.error("failed to write initial output", { taskId, error: String(err) })
        }
      })()
    }

    // Fire-and-forget: Save initial state (non-blocking for faster migration)
    void (async () => {
      try {
        await TaskPersistence.save(directory, task)
      } catch (err) {
        log.error("failed to save initial task state", { taskId, error: String(err) })
      }
    })()

    // Handle stdout
    opts.process.stdout?.on("data", (chunk: Buffer) => {
      const data = chunk.toString()
      task.output.push(data)
      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.appendLog(directory, taskId, data)
          } catch (err) {
            log.error("failed to append stdout to log", { taskId, error: String(err) })
          }
          try {
            await Bus.publish(TaskEvent.Output, { id: taskId, data, isError: false })
          } catch (err) {
            log.error("failed to publish stdout event", { taskId, error: String(err) })
          }
        },
      })
    })

    // Handle stderr
    opts.process.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString()
      task.output.push(data)
      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.appendLog(directory, taskId, data)
          } catch (err) {
            log.error("failed to append stderr to log", { taskId, error: String(err) })
          }
          try {
            await Bus.publish(TaskEvent.Output, { id: taskId, data, isError: true })
          } catch (err) {
            log.error("failed to publish stderr event", { taskId, error: String(err) })
          }
        },
      })
    })

    // Handle exit
    opts.process.on("exit", (code) => {
      task.exitCode = code ?? undefined
      task.status = code === 0 ? "completed" : "failed"
      task.process = undefined

      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.save(directory, task)
          } catch (err) {
            log.error("failed to save task state on exit", { taskId, error: String(err) })
          }
          try {
            await Bus.publish(TaskEvent.Completed, { id: taskId, exitCode: code, status: task.status })
          } catch (err) {
            log.error("failed to publish completed event", { taskId, error: String(err) })
          }
          log.info("adopted task completed", { taskId, exitCode: code, status: task.status })
        },
      })
    })

    // Handle errors
    opts.process.once("error", (err) => {
      log.error("adopted task error", { taskId, error: String(err) })
      task.status = "failed"
      task.process = undefined

      void Instance.provide({
        directory,
        fn: async () => {
          try {
            await TaskPersistence.save(directory, task)
          } catch (e) {
            log.error("failed to save task state after error", { taskId, error: String(e) })
          }
          try {
            await Bus.publish(TaskEvent.Completed, { id: taskId, exitCode: null, status: "failed" })
          } catch (e) {
            log.error("failed to publish completed event after error", { taskId, error: String(e) })
          }
        },
      })
    })

    // Publish created event
    try {
      await Bus.publish(TaskEvent.Created, {
        info: {
          id: task.id,
          pid: task.pid,
          command: task.command,
          startTime: task.startTime,
          status: task.status,
          workdir: task.workdir,
          description: task.description,
          logFile: task.logFile,
          reconnectable: task.reconnectable,
        },
      })
    } catch (err) {
      log.error("failed to publish created event", { taskId, error: String(err) })
    }

    return {
      id: task.id,
      pid: task.pid,
      command: task.command,
      startTime: task.startTime,
      status: task.status,
      workdir: task.workdir,
      description: task.description,
      logFile: task.logFile,
      reconnectable: task.reconnectable,
    }
  }
}
