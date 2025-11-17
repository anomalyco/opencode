import { Rpc } from "@/util/rpc"
import type { rpc as SubagentRpc } from "./workers/subagent.worker"
import { appendFile } from "fs/promises"

interface SubagentWorkerInfo {
  worker: Worker
  client: ReturnType<typeof Rpc.client<typeof SubagentRpc>>
  state: {
    sessionID: string
    agentName: string
    status: "initializing" | "running" | "completed" | "failed"
    progress: {
      toolCalls: number
      tokensUsed: number
      cost: number
    }
    result?: string
    error?: string
  }
  startedAt: number
}

const activeWorkers = new Map<string, SubagentWorkerInfo>()

async function log(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-subagent-manager.log", `[${timestamp}] ${msg}\n`)
}

export namespace SubagentManager {
  /**
   * Spawn a new subagent in an isolated worker thread
   */
  export async function spawn(options: {
    serverUrl: string
    parentSessionID: string
    agentName: string
    prompt: string
    description: string
    parallel?: boolean
  }): Promise<string> {
    const workerId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await log(`Spawning subagent worker: ${workerId} for ${options.agentName}`)

    const worker = new Worker(new URL("./workers/subagent.worker.ts", import.meta.url))

    const info: SubagentWorkerInfo = {
      worker,
      client: null as any,
      state: {
        sessionID: "",
        agentName: options.agentName,
        status: "initializing",
        progress: { toolCalls: 0, tokensUsed: 0, cost: 0 },
      },
      startedAt: Date.now(),
    }

    // Handle state updates from worker
    worker.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === "state.update") {
          info.state = msg.state
          await log(`Worker ${workerId} state update: ${msg.state.status}`)
        }
      } catch {
        // Not our message format
      }
    }

    worker.onerror = async (err) => {
      await log(`Worker ${workerId} error: ${err}`)
      info.state.status = "failed"
      info.state.error = String(err)
    }

    info.client = Rpc.client<typeof SubagentRpc>(worker)
    activeWorkers.set(workerId, info)

    // Initialize worker
    const result = (await info.client.call("init", {
      serverUrl: options.serverUrl,
      parentSessionID: options.parentSessionID,
      agentName: options.agentName,
      prompt: options.prompt,
      description: options.description,
      parallel: options.parallel ?? false,
    })) as unknown as { ready: boolean; state: SubagentWorkerInfo["state"] }

    info.state = result.state
    await log(`Worker ${workerId} initialized: ${info.state.sessionID}`)

    return workerId
  }

  /**
   * Get status of a subagent worker
   */
  export function getStatus(workerId: string): SubagentWorkerInfo["state"] | null {
    const info = activeWorkers.get(workerId)
    return info?.state ?? null
  }

  /**
   * Get all active workers
   */
  export function listActive(): Array<{ id: string; state: SubagentWorkerInfo["state"] }> {
    return Array.from(activeWorkers.entries()).map(([id, info]) => ({
      id,
      state: info.state,
    }))
  }

  /**
   * Wait for a subagent to complete
   */
  export async function waitForCompletion(workerId: string, timeoutMs = 300000): Promise<string> {
    const info = activeWorkers.get(workerId)
    if (!info) throw new Error(`Worker ${workerId} not found`)

    const startTime = Date.now()

    while (info.state.status === "initializing" || info.state.status === "running") {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Worker ${workerId} timed out after ${timeoutMs}ms`)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (info.state.status === "failed") {
      throw new Error(info.state.error || "Worker failed")
    }

    return info.state.result || "Task completed"
  }

  /**
   * Abort a running subagent
   */
  export async function abort(workerId: string): Promise<void> {
    const info = activeWorkers.get(workerId)
    if (!info) return

    await log(`Aborting worker ${workerId}`)
    await info.client.call("abort", undefined)
  }

  /**
   * Terminate a worker and clean up
   */
  export async function terminate(workerId: string): Promise<void> {
    const info = activeWorkers.get(workerId)
    if (!info) return

    await log(`Terminating worker ${workerId}`)
    await info.client.call("shutdown", undefined)
    info.worker.terminate()
    activeWorkers.delete(workerId)
  }

  /**
   * Terminate all workers
   */
  export async function terminateAll(): Promise<void> {
    await log(`Terminating all ${activeWorkers.size} workers`)
    for (const [id] of activeWorkers) {
      await terminate(id)
    }
  }
}
