// Subagent Worker - runs subagent session in isolated thread
// Each subagent gets its own worker for true parallelism
import { Rpc } from "@/util/rpc"
import { appendFile } from "fs/promises"

interface SubagentState {
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
  startedAt: number
  completedAt?: number
}

let state: SubagentState = {
  sessionID: "",
  agentName: "",
  status: "initializing",
  progress: {
    toolCalls: 0,
    tokensUsed: 0,
    cost: 0,
  },
  startedAt: Date.now(),
}

let config: {
  serverUrl: string
  parentSessionID: string
  agentName: string
  prompt: string
  description: string
  parallel: boolean
}

async function logWorker(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-subagent-worker.log", `[${timestamp}] [${state.agentName || "init"}] ${msg}\n`)
}

function broadcastState() {
  postMessage(
    JSON.stringify({
      type: "state.update",
      state,
    }),
  )
}

// Execute subagent via server API
async function executeSubagent(): Promise<void> {
  await logWorker(`Starting subagent: ${config.agentName}`)
  state.status = "running"
  state.agentName = config.agentName
  broadcastState()

  try {
    // Create child session via API
    const createResponse = await fetch(`${config.serverUrl}session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `[@${config.agentName.toUpperCase()}] ${config.description}`,
        parentID: config.parentSessionID,
      }),
    })

    if (!createResponse.ok) {
      throw new Error(`Failed to create session: ${createResponse.status}`)
    }

    const session = await createResponse.json()
    state.sessionID = session.id
    await logWorker(`Created child session: ${session.id}`)
    broadcastState()

    // Send prompt to child session
    const promptResponse = await fetch(`${config.serverUrl}session/${session.id}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: config.prompt }],
      }),
    })

    if (!promptResponse.ok) {
      throw new Error(`Failed to send prompt: ${promptResponse.status}`)
    }

    await logWorker("Prompt sent, monitoring progress...")

    // Poll for completion
    let completed = false
    while (!completed) {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await fetch(`${config.serverUrl}session/${session.id}`)
      if (!statusResponse.ok) continue

      const sessionStatus = await statusResponse.json()

      // Check if session is still running
      if (sessionStatus.orchestration?.status === "completed") {
        completed = true
        state.result = sessionStatus.orchestration.result || "Task completed"
        state.status = "completed"
        state.completedAt = Date.now()
        await logWorker(`Subagent completed: ${state.result?.substring(0, 100)}...`)
      } else if (sessionStatus.orchestration?.status === "failed") {
        completed = true
        state.error = sessionStatus.orchestration.result || "Task failed"
        state.status = "failed"
        state.completedAt = Date.now()
        await logWorker(`Subagent failed: ${state.error}`)
      }

      // Update progress
      const messagesResponse = await fetch(`${config.serverUrl}session/${session.id}/message`)
      if (messagesResponse.ok) {
        const messages = await messagesResponse.json()
        let toolCalls = 0
        let tokensUsed = 0
        let cost = 0

        for (const msg of messages) {
          if (msg.role === "assistant") {
            cost += msg.cost || 0
            tokensUsed += (msg.tokens?.input || 0) + (msg.tokens?.output || 0)
          }
        }

        state.progress = { toolCalls, tokensUsed, cost }
        broadcastState()
      }
    }

    broadcastState()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await logWorker(`Subagent error: ${errorMsg}`)
    state.status = "failed"
    state.error = errorMsg
    state.completedAt = Date.now()
    broadcastState()
  }
}

// RPC handlers
export const rpc = {
  async init(cfg: typeof config) {
    config = cfg
    state.startedAt = Date.now()
    await logWorker(`Subagent worker initialized for parent: ${cfg.parentSessionID}`)
    await logWorker(`Agent: ${cfg.agentName}, Prompt: ${cfg.prompt.substring(0, 100)}...`)

    // Start execution immediately
    executeSubagent()

    return { ready: true, state }
  },

  async getState() {
    return state
  },

  async abort() {
    await logWorker("Abort requested")
    // TODO: Implement abort via session lock
    state.status = "failed"
    state.error = "Aborted by user"
    broadcastState()
  },

  async shutdown() {
    await logWorker("Subagent worker shutting down")
  },
}

Rpc.listen(rpc)
