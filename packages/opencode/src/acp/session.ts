import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "acp-session-manager" })

/** Session TTL in milliseconds (1 hour) */
const SESSION_TTL_MS = 60 * 60 * 1000
/** Cleanup interval in milliseconds (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
/** Maximum number of sessions to keep */
const MAX_SESSIONS = 50

interface SessionEntry {
  state: ACPSessionState
  lastAccess: number
}

export class ACPSessionManager {
  private sessions = new Map<string, SessionEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | undefined
  private sdk: OpencodeClient

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
    this.startCleanupTimer()
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref()
  }

  private cleanup() {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [id, entry] of this.sessions) {
      if (now - entry.lastAccess > SESSION_TTL_MS) {
        toDelete.push(id)
      }
    }

    if (toDelete.length > 0) {
      log.info("cleaning_up_stale_sessions", { count: toDelete.length })
      for (const id of toDelete) {
        this.sessions.delete(id)
      }
    }

    if (this.sessions.size > MAX_SESSIONS) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
      const excess = sorted.slice(0, this.sessions.size - MAX_SESSIONS)
      log.info("evicting_excess_sessions", { count: excess.length })
      for (const [id] of excess) {
        this.sessions.delete(id)
      }
    }
  }

  dispose() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
    this.sessions.clear()
  }

  tryGet(sessionId: string): ACPSessionState | undefined {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.lastAccess = Date.now()
      return entry.state
    }
    return undefined
  }

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .create(
        {
          title: `ACP Session ${crypto.randomUUID()}`,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const sessionId = session.id
    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }
    log.info("creating_session", { state })

    this.sessions.set(sessionId, { state, lastAccess: Date.now() })
    return state
  }

  async load(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .get(
        {
          sessionID: sessionId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(session.time.created),
      model: resolvedModel,
    }
    log.info("loading_session", { state })

    this.sessions.set(sessionId, { state, lastAccess: Date.now() })
    return state
  }

  get(sessionId: string): ACPSessionState {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      log.error("session not found", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }
    entry.lastAccess = Date.now()
    return entry.state
  }

  getModel(sessionId: string) {
    const session = this.get(sessionId)
    return session.model
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId)
    session.model = model
    return session
  }

  getVariant(sessionId: string) {
    const session = this.get(sessionId)
    return session.variant
  }

  setVariant(sessionId: string, variant?: string) {
    const session = this.get(sessionId)
    session.variant = variant
    return session
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    return session
  }
}
