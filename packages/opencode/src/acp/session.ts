import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import { Storage } from "@/storage/storage"
import type { OpencodeClient } from "@opencode-ai/sdk"

const log = Log.create({ service: "acp-session-manager" })

const STORAGE_PREFIX = "acp_session" as const

interface StoredACPSession {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: string
  model?: { providerID: string; modelID: string }
  modeId?: string
}

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private sdk: OpencodeClient

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  private toStorable(state: ACPSessionState): StoredACPSession {
    return {
      id: state.id,
      cwd: state.cwd,
      mcpServers: state.mcpServers,
      createdAt: state.createdAt instanceof Date ? state.createdAt.toISOString() : state.createdAt,
      model: state.model,
      modeId: state.modeId,
    }
  }

  private fromStorable(stored: StoredACPSession): ACPSessionState {
    return {
      id: stored.id,
      cwd: stored.cwd,
      mcpServers: stored.mcpServers,
      createdAt: new Date(stored.createdAt),
      model: stored.model,
      modeId: stored.modeId,
    }
  }

  private async persist(state: ACPSessionState): Promise<void> {
    await Storage.write([STORAGE_PREFIX, state.id], this.toStorable(state))
  }

  async load(sessionId: string): Promise<ACPSessionState | null> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached

    const stored = await Storage.read<StoredACPSession>([STORAGE_PREFIX, sessionId]).catch(() => null)
    if (!stored) return null

    const state = this.fromStorable(stored)
    this.sessions.set(sessionId, state)
    return state
  }

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .create({
        body: {
          title: `ACP Session ${crypto.randomUUID()}`,
        },
        query: {
          directory: cwd,
        },
        throwOnError: true,
      })
      .then((x) => x.data)

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
    await this.persist(state)

    return state
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
    this.persist(session).catch((err) => log.error("failed_to_persist_model_update", { sessionId, err }))

    return session
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    this.persist(session).catch((err) => log.error("failed_to_persist_mode_update", { sessionId, err }))

    return session
  }
}
