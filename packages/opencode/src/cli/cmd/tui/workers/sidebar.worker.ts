// Sidebar Worker - computes state in isolated thread
import { Rpc } from "@/util/rpc"
import { appendFile } from "fs/promises"

interface SidebarState {
  todos: Array<{
    id: string
    content: string
    status: "pending" | "in_progress" | "completed"
  }>
  gitStatus: {
    branch: string
    ahead: number
    behind: number
    modified: number
    staged: number
    untracked: number
  }
  context: Array<{
    id: string
    name: string
    type: string
    active: boolean
  }>
  systemPromptTokens: number
  messageStats: {
    totalCost: number
    savedCost: number
    toolCounts: Record<string, number>
    lastTokenUsage: number
    lastTokenLimit: number
  }
  diffStats: {
    totalFiles: number
    additions: number
    deletions: number
    modified: number
  }
  lastUpdated: number
}

let config: {
  serverUrl: string
  sessionID: string
}

let state: SidebarState = {
  todos: [],
  gitStatus: {
    branch: "main",
    ahead: 0,
    behind: 0,
    modified: 0,
    staged: 0,
    untracked: 0,
  },
  context: [],
  systemPromptTokens: 0,
  messageStats: {
    totalCost: 0,
    savedCost: 0,
    toolCounts: {},
    lastTokenUsage: 0,
    lastTokenLimit: 0,
  },
  diffStats: {
    totalFiles: 0,
    additions: 0,
    deletions: 0,
    modified: 0,
  },
  lastUpdated: Date.now(),
}

// Log to file since console.log won't show in TUI
async function logWorker(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-sidebar-worker.log", `[${timestamp}] ${msg}\n`)
}

function broadcastState() {
  postMessage(
    JSON.stringify({
      type: "state.update",
      state,
    }),
  )
}

async function computeTokenCount(text: string): Promise<number> {
  return Math.ceil(text.length / 4)
}

async function fetchGitStatus(): Promise<void> {
  if (!config?.serverUrl) return
  await logWorker("Fetching git status...")
  try {
    const response = await fetch(`${config.serverUrl}git/status`)
    if (response.ok) {
      const data = await response.json()
      state.gitStatus = {
        branch: data.branch || "main",
        ahead: data.ahead || 0,
        behind: data.behind || 0,
        modified: data.modified || 0,
        staged: data.staged || 0,
        untracked: data.untracked || 0,
      }
      await logWorker(`Git status updated: ${JSON.stringify(state.gitStatus)}`)
      broadcastState()
    } else {
      await logWorker(`Git status fetch failed: ${response.status}`)
    }
  } catch (err) {
    await logWorker(`Git status error: ${err}`)
  }
}

// RPC handlers
export const rpc = {
  async init(cfg: typeof config) {
    config = cfg
    await logWorker(`Worker initialized for session: ${cfg.sessionID}`)
    await logWorker(`Server URL: ${cfg.serverUrl}`)
    fetchGitStatus()
    return { ready: true, state }
  },

  async getState() {
    return state
  },

  async updateTodos(todos: SidebarState["todos"]) {
    state.todos = todos
    state.lastUpdated = Date.now()
    broadcastState()
    return { updated: true }
  },

  async updateContext(contexts: SidebarState["context"]) {
    state.context = contexts
    state.lastUpdated = Date.now()
    broadcastState()
    return { updated: true }
  },

  async computeTokens(text: string) {
    const tokens = await computeTokenCount(text)
    state.systemPromptTokens = tokens
    broadcastState()
    return { tokens }
  },

  // Heavy computation: message stats (costs, token usage)
  async computeMessageStats(input: {
    messages: Array<{
      role: string
      cost?: number
      tokens?: { input?: number; output?: number; cache?: { read?: number } }
      providerID?: string
      modelID?: string
    }>
    providers: Array<{
      id: string
      models: Record<string, { limit: { context: number }; cost: { input: number; cache_read?: number } }>
    }>
  }) {
    const { messages, providers } = input
    await logWorker(`Computing message stats for ${messages.length} messages`)

    const providersById = new Map(providers.map((p) => [p.id, p]))
    let totalCost = 0
    let savedCost = 0
    let lastTokenUsage = 0
    let lastTokenLimit = 0

    for (const msg of messages) {
      if (msg.role === "assistant") {
        totalCost += msg.cost || 0

        if ((msg.tokens?.output || 0) > 0) {
          lastTokenUsage = (msg.tokens?.input || 0) + (msg.tokens?.output || 0)
          const provider = providersById.get(msg.providerID || "")
          if (provider && msg.modelID) {
            lastTokenLimit = provider.models[msg.modelID]?.limit.context || 0
          }
        }

        const provider = providersById.get(msg.providerID || "")
        if (provider && msg.modelID && msg.tokens) {
          const model = provider.models[msg.modelID]
          if (model) {
            const cacheRead = msg.tokens.cache?.read || 0
            const cacheReadCostPer1k = model.cost.cache_read || model.cost.input * 0.1
            savedCost += (cacheRead / 1000) * (model.cost.input - cacheReadCostPer1k)
          }
        }
      }
    }

    state.messageStats = {
      totalCost,
      savedCost,
      toolCounts: state.messageStats.toolCounts,
      lastTokenUsage,
      lastTokenLimit,
    }

    await logWorker(
      `Stats computed: cost=$${totalCost.toFixed(4)}, saved=$${savedCost.toFixed(4)}, tokens=${lastTokenUsage}/${lastTokenLimit}`,
    )
    broadcastState()
    return state.messageStats
  },

  // Heavy computation: diff parsing
  async computeDiffStats(diffs: Array<{ additions?: number; deletions?: number; status?: string }>) {
    await logWorker(`Computing diff stats for ${diffs.length} files`)

    let additions = 0
    let deletions = 0
    let modified = 0

    for (const diff of diffs) {
      additions += diff.additions || 0
      deletions += diff.deletions || 0
      if (diff.status === "modified") modified++
    }

    state.diffStats = {
      totalFiles: diffs.length,
      additions,
      deletions,
      modified,
    }

    await logWorker(`Diff stats: ${diffs.length} files, +${additions} -${deletions}`)
    broadcastState()
    return state.diffStats
  },

  async refreshGitStatus() {
    await logWorker("Refresh git status called")
    await fetchGitStatus()
    return state.gitStatus
  },

  async shutdown() {
    await logWorker("Worker shutting down")
  },
}

Rpc.listen(rpc)
