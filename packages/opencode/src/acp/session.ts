import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

const log = Log.create({ service: "acp-session-manager" })

export class ACPSessionManager {
  private static readonly MAX_SESSIONS = 100
  private sessions = new Map<string, ACPSessionState>()
  private sessionOrder: string[] = []
  private sdk: OpencodeClient

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  private evictOldest() {
    while (this.sessions.size > ACPSessionManager.MAX_SESSIONS && this.sessionOrder.length > 0) {
      const oldest = this.sessionOrder.shift()
      if (oldest) {
        this.sessions.delete(oldest)
        log.info("evicted_session", { sessionId: oldest })
      }
    }
  }

  private trackSession(sessionId: string) {
    const idx = this.sessionOrder.indexOf(sessionId)
    if (idx !== -1) this.sessionOrder.splice(idx, 1)
    this.sessionOrder.push(sessionId)
    this.evictOldest()
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

    this.sessions.set(sessionId, state)
    this.trackSession(sessionId)
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

    this.sessions.set(sessionId, state)
    this.trackSession(sessionId)
    return state
  }

  remove(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId)
    const idx = this.sessionOrder.indexOf(sessionId)
    if (idx !== -1) this.sessionOrder.splice(idx, 1)
    if (existed) log.info("removed_session", { sessionId })
    return existed
  }

  clear() {
    const count = this.sessions.size
    this.sessions.clear()
    this.sessionOrder.length = 0
    log.info("cleared_all_sessions", { count })
  }

  get(sessionId: string): ACPSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.error("session not found", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }
    return session
  }

  getModel(sessionId: string) {
    const session = this.get(sessionId)
    return session.model
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId)
    session.model = model
    this.sessions.set(sessionId, session)
    return session
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    return session
  }
}
