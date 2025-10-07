import type { McpServer } from "@zed-industries/agent-client-protocol"
import { Identifier } from "../id/id"
import { Session } from "../session"
import type { ACPSessionState } from "./types"

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()

  async create(cwd: string, mcpServers: McpServer[]): Promise<ACPSessionState> {
    const sessionId = `acp_${Identifier.ascending("session")}`
    const openCodeSession = await Session.create({ title: `ACP Session ${sessionId}` })

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      openCodeSessionId: openCodeSession.id,
      createdAt: new Date(),
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

  async load(sessionId: string, cwd: string, mcpServers: McpServer[]): Promise<ACPSessionState> {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }

    const openCodeSession = await Session.create({ title: `ACP Session ${sessionId} (loaded)` })

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      openCodeSessionId: openCodeSession.id,
      createdAt: new Date(),
    }

    this.sessions.set(sessionId, state)
    return state
  }
}
