import type { McpServer } from "@agentclientprotocol/sdk"
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
    const session = await Session.create({ title: `ACP Session ${crypto.randomUUID()}` })
    const sessionId = session.id
    const resolvedModel = model ?? (await Provider.defaultModel())

    const state: ACPSessionState = {
      id: sessionId,
      parentId: session.parentID,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }

    this.sessions.set(sessionId, state)
    return state
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  async remove(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return

    await Session.remove(sessionId).catch(() => {})
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
