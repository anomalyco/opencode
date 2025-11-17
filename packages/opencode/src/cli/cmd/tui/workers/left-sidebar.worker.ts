// Left Sidebar Worker - computes session list state in isolated thread
import { Rpc } from "@/util/rpc"
import { appendFile } from "fs/promises"

interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  parentID?: string
  share?: string
}

interface LeftSidebarState {
  sessions: SessionInfo[]
  categorized: {
    today: SessionInfo[]
    yesterday: SessionInfo[]
    thisWeek: SessionInfo[]
    lastWeek: SessionInfo[]
    older: SessionInfo[]
  }
  searchResults: SessionInfo[]
  lastUpdated: number
}

let config: {
  serverUrl: string
  currentSessionID: string
}

let state: LeftSidebarState = {
  sessions: [],
  categorized: {
    today: [],
    yesterday: [],
    thisWeek: [],
    lastWeek: [],
    older: [],
  },
  searchResults: [],
  lastUpdated: Date.now(),
}

async function logWorker(msg: string) {
  const timestamp = new Date().toISOString()
  await appendFile("/tmp/opencode-left-sidebar-worker.log", `[${timestamp}] ${msg}\n`)
}

function broadcastState() {
  postMessage(
    JSON.stringify({
      type: "state.update",
      state,
    }),
  )
}

// Heavy computation: categorize sessions by date
function categorizeSessions(sessions: SessionInfo[]) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 24 * 60 * 60 * 1000)
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const result = {
    today: [] as SessionInfo[],
    yesterday: [] as SessionInfo[],
    thisWeek: [] as SessionInfo[],
    lastWeek: [] as SessionInfo[],
    older: [] as SessionInfo[],
  }

  for (const session of sessions) {
    const date = new Date(session.updatedAt)
    if (date >= todayStart) {
      result.today.push(session)
    } else if (date >= yesterdayStart) {
      result.yesterday.push(session)
    } else if (date >= weekStart) {
      result.thisWeek.push(session)
    } else if (date >= lastWeekStart) {
      result.lastWeek.push(session)
    } else {
      result.older.push(session)
    }
  }

  return result
}

// Heavy computation: search sessions
function searchSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  if (!query.trim()) return []

  const lowerQuery = query.toLowerCase()
  return sessions.filter((s) => s.title.toLowerCase().includes(lowerQuery) || s.id.toLowerCase().includes(lowerQuery))
}

// Fetch sessions from server
async function fetchSessions(): Promise<void> {
  if (!config?.serverUrl) return
  await logWorker("Fetching sessions...")

  try {
    const response = await fetch(`${config.serverUrl}session`)
    if (response.ok) {
      const data = await response.json()
      // Filter to root sessions only (no parentID)
      const rootSessions = (data.sessions || data || [])
        .filter((s: any) => !s.parentID)
        .map((s: any) => ({
          id: s.id,
          title: s.title || "Untitled",
          createdAt: new Date(s.time?.created || s.createdAt || Date.now()).getTime(),
          updatedAt: new Date(s.time?.updated || s.updatedAt || Date.now()).getTime(),
          parentID: s.parentID,
          share: s.share,
        }))
        .sort((a: SessionInfo, b: SessionInfo) => b.updatedAt - a.updatedAt)

      state.sessions = rootSessions
      state.categorized = categorizeSessions(rootSessions)
      state.lastUpdated = Date.now()

      await logWorker(
        `Sessions categorized: today=${state.categorized.today.length}, yesterday=${state.categorized.yesterday.length}, thisWeek=${state.categorized.thisWeek.length}, lastWeek=${state.categorized.lastWeek.length}, older=${state.categorized.older.length}`,
      )
      broadcastState()
    } else {
      await logWorker(`Sessions fetch failed: ${response.status}`)
    }
  } catch (err) {
    await logWorker(`Sessions fetch error: ${err}`)
  }
}

// RPC handlers
export const rpc = {
  async init(cfg: typeof config) {
    config = cfg
    await logWorker(`Left sidebar worker initialized`)
    await logWorker(`Server URL: ${cfg.serverUrl}`)
    fetchSessions()
    return { ready: true, state }
  },

  async getState() {
    return state
  },

  async refreshSessions() {
    await logWorker("Refresh sessions called")
    await fetchSessions()
    return state.sessions
  },

  async search(query: string) {
    await logWorker(`Search: "${query}"`)
    state.searchResults = searchSessions(state.sessions, query)
    await logWorker(`Search results: ${state.searchResults.length}`)
    broadcastState()
    return state.searchResults
  },

  async recategorize() {
    await logWorker("Recategorizing sessions")
    state.categorized = categorizeSessions(state.sessions)
    broadcastState()
    return state.categorized
  },

  async shutdown() {
    await logWorker("Left sidebar worker shutting down")
  },
}

Rpc.listen(rpc)
