import { TeamJules, type TaskInfo, type WorkerID } from "@opencode-ai/core/teamjules"
import { Effect, Runtime } from "effect"
import { createRunner, type RunnerConfig } from "./runner"

export interface WorkerConfig {
  pollIntervalMs?: number
  workDir?: string
  githubToken?: string
  model?: { providerID: string; modelID: string }
  agent?: {
    prompt?: string
  }
}

export interface Worker {
  start(): Promise<void>
  stop(): Promise<void>
}

export function createWorker(service: TeamJules.Interface, config: WorkerConfig = {}): Worker {
  const runner = createRunner()
  let running = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let workerId: WorkerID | null = null

  async function poll() {
    if (!running || !workerId) return

    try {
      await Effect.runPromise(service.heartbeat(workerId))

      const task = await Effect.runPromise(service.claimTask(workerId))
      if (task) {
        console.log(`[TeamJules] Processing task ${task.id}`)
        await processTask(task)
      }
    } catch (error) {
      console.error("[TeamJules] Worker error:", error)
    }

    if (running) {
      pollTimer = setTimeout(poll, config.pollIntervalMs ?? 1_000)
    }
  }

  async function processTask(task: TaskInfo) {
    try {
      const result = await runner.run(task, {
        workDir: config.workDir,
        githubToken: config.githubToken,
        model: config.model,
        agent: config.agent,
      })

      if (result.error) {
        await Effect.runPromise(service.failTask(task.id, result.error))
      } else {
        await Effect.runPromise(service.completeTask(task.id, result))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await Effect.runPromise(service.failTask(task.id, message))
    }
  }

  return {
    async start() {
      if (running) return

      const worker = await Effect.runPromise(service.registerWorker())
      workerId = worker.id
      running = true
      console.log(`[TeamJules] Worker ${workerId} started`)

      poll()
    },

    async stop() {
      running = false
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      if (workerId) {
        await Effect.runPromise(service.deregisterWorker(workerId))
        console.log(`[TeamJules] Worker ${workerId} stopped`)
        workerId = null
      }
    },
  }
}
