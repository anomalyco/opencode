import * as vscode from "vscode"
import { AcpClient } from "../acp/client"

const SESSIONS_KEY = "opencode.sessionManager.activeSessions"

export interface SessionMetadata {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd: string
  acpSessionId: string
}

export class SessionManager {
  private context: vscode.ExtensionContext
  private client: AcpClient
  private activeSessionId: string | undefined

  constructor(context: vscode.ExtensionContext, client: AcpClient) {
    this.context = context
    this.client = client
  }

  async getOrCreateSession(chatContext: vscode.ChatContext): Promise<string> {
    // Check if there's an existing session in ChatResult.metadata
    const existingSessionId = this.extractSessionIdFromContext(chatContext)
    if (existingSessionId) {
      const sessions = this.getSessionsFromStorage()
      const existingSession = sessions[existingSessionId]
      if (existingSession) {
        await this.loadAcpSession(existingSession.acpSessionId)
        this.activeSessionId = existingSessionId
        return existingSessionId
      }
    }

    // Create new session
    const session = await this.createNewSession()
    this.activeSessionId = session.id

    return session.id
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const sessions = this.getSessionsFromStorage()
    return Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const sessions = this.getSessionsFromStorage()
    const session = sessions[sessionId]

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    session.title = title
    session.updatedAt = Date.now()

    await this.saveSessionsToStorage(sessions)
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessions = this.getSessionsFromStorage()

    if (!sessions[sessionId]) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    delete sessions[sessionId]
    await this.saveSessionsToStorage(sessions)

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined
    }
  }

  private extractSessionIdFromContext(chatContext: vscode.ChatContext): string | undefined {
    for (const turn of chatContext.history) {
      if ("result" in turn && turn.result?.metadata?.sessionId) {
        return turn.result.metadata.sessionId as string
      }
    }
    return undefined
  }

  private async createNewSession(): Promise<SessionMetadata> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    const acpResponse = await this.client.createSession({ cwd })

    const session: SessionMetadata = {
      id: this.generateSessionId(),
      title: "New Session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd,
      acpSessionId: acpResponse.sessionId,
    }

    const sessions = this.getSessionsFromStorage()
    sessions[session.id] = session
    await this.saveSessionsToStorage(sessions)

    return session
  }

  private async loadAcpSession(acpSessionId: string): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    await this.client.loadSession({ sessionId: acpSessionId, cwd })
  }

  private generateSessionId(): string {
    return `vsc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  }

  private getSessionsFromStorage(): Record<string, SessionMetadata> {
    return this.context.workspaceState.get<Record<string, SessionMetadata>>(SESSIONS_KEY) ?? {}
  }

  private async saveSessionsToStorage(sessions: Record<string, SessionMetadata>): Promise<void> {
    await this.context.workspaceState.update(SESSIONS_KEY, sessions)
  }
}

export default SessionManager
