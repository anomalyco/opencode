import type { McpServer } from "@agentclientprotocol/sdk"
import { Identifier } from "../id/id"
import { Session } from "../session"
import { Provider } from "../provider/provider"
import type { ACPSessionState } from "./types"

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private openCodeSessionToAcp = new Map<string, string>()

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
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
    this.openCodeSessionToAcp.set(openCodeSession.id, sessionId)
    return state
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  getByOpenCodeSessionId(openCodeSessionId: string) {
    const acpSessionId = this.openCodeSessionToAcp.get(openCodeSessionId)
    if (!acpSessionId) return undefined
    return this.sessions.get(acpSessionId)
  }

  async remove(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    await Session.remove(state.openCodeSessionId).catch(() => {})
    this.openCodeSessionToAcp.delete(state.openCodeSessionId)
    this.sessions.delete(sessionId)
  }

  has(sessionId: string) {
    return this.sessions.has(sessionId)
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

  setMode(sessionId: string, modeId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    return session
  }
}
