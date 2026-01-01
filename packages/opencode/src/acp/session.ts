import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Storage } from "@/storage/storage"

const log = Log.create({ service: "acp-session-manager" })

// Serializable version of ACPSessionState for disk persistence
interface PersistedACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: string // ISO string instead of Date
  model?: {
    providerID: string
    modelID: string
  }
  modeId?: string
}

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private sdk: OpencodeClient

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  /**
   * Persist session state to disk for recovery after process restart
   */
  private async persistState(state: ACPSessionState): Promise<void> {
    const persisted: PersistedACPSessionState = {
      ...state,
      createdAt: state.createdAt.toISOString(),
    }
    await Storage.write(["acp_state", state.id], persisted)
    log.info("persisted_session_state", { sessionId: state.id })
  }

  /**
   * Try to restore session state from disk
   */
  private async restoreState(sessionId: string): Promise<ACPSessionState | undefined> {
    try {
      const persisted = await Storage.read<PersistedACPSessionState>(["acp_state", sessionId])
      const state: ACPSessionState = {
        ...persisted,
        createdAt: new Date(persisted.createdAt),
      }
      // Cache in memory after restore
      this.sessions.set(sessionId, state)
      log.info("restored_session_state", { sessionId })
      return state
    } catch (e) {
      // Session not found on disk
      if (e instanceof Storage.NotFoundError) {
        return undefined
      }
      throw e
    }
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
    await this.persistState(state)
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
    await this.persistState(state)
    return state
  }

  /**
   * Get session from memory, or try to restore from disk if not found.
   * This handles the case where the ACP process restarted but the session
   * was previously created/loaded.
   */
  async get(sessionId: string): Promise<ACPSessionState> {
    // First, try in-memory cache
    const cached = this.sessions.get(sessionId)
    if (cached) {
      return cached
    }

    // Try to restore from disk (handles process restart case)
    const restored = await this.restoreState(sessionId)
    if (restored) {
      return restored
    }

    // Session truly doesn't exist
    log.error("session not found", { sessionId })
    throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
  }

  /**
   * Synchronous get - only checks in-memory cache.
   * Use this only when you're certain the session is already loaded.
   */
  private getSync(sessionId: string): ACPSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.error("session not found in memory", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }
    return session
  }

  async getModel(sessionId: string) {
    const session = await this.get(sessionId)
    return session.model
  }

  async setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = await this.get(sessionId)
    session.model = model
    this.sessions.set(sessionId, session)
    await this.persistState(session)
    return session
  }

  async setMode(sessionId: string, modeId: string) {
    const session = await this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    await this.persistState(session)
    return session
  }
}
