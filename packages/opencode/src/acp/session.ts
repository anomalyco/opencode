import type { McpServer } from "@agentclientprotocol/sdk"
import { Identifier } from "../id/id"
import { Session } from "../session"
import { Provider } from "../provider/provider"
import type { ACPSessionState } from "./types"

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()

  async create(
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const sessionId = `acp_${Identifier.ascending("session")}`
    const openCodeSession = await Session.create({ title: `ACP Session ${sessionId}` })
    const resolvedModel = model ?? (await Provider.defaultModel())

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      openCodeSessionId: openCodeSession.id,
      createdAt: new Date(),
      model: resolvedModel,
    }

    this.sessions.set(sessionId, state)
    return state
  }

  get(sessionId: string): ACPSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  async remove(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return

    await Session.remove(state.openCodeSessionId).catch(() => {})
    this.sessions.delete(sessionId)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  async load(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      if (!existing.model) {
        const resolved = model ?? (await Provider.defaultModel())
        existing.model = resolved
        this.sessions.set(sessionId, existing)
      }
      return existing
    }

    const openCodeSession = await Session.create({ title: `ACP Session ${sessionId} (loaded)` })
    const resolvedModel = model ?? (await Provider.defaultModel())

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      openCodeSessionId: openCodeSession.id,
      createdAt: new Date(),
      model: resolvedModel,
    }

    this.sessions.set(sessionId, state)
    return state
  }

  getModel(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    return session.model
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.model = model
    this.sessions.set(sessionId, session)
    return session
  }
}
