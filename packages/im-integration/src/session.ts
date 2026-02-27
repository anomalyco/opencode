import { Config } from "@opencode-ai/config"

export interface SessionMapping {
  chatId: string
  sessionId: string
  project: string | null
  createdAt: number
  compactedAt: number | null
  messageCount: number
  mediaCount: number
}

export interface SessionStats {
  exists: boolean
  sessionId?: string
  project?: string | null
  messageCount?: number
  mediaCount?: number
  createdAt?: number
  compactedAt?: number | null
  isCompacted?: boolean
}

export class SessionManager {
  private sessions = new Map<string, SessionMapping>()
  private defaultProject: string | null = null

  constructor(
    private opencode: any,
    private config: any,
  ) {
    this.loadDefaultProject()
  }

  private async loadDefaultProject(): Promise<void> {
    const projects = this.config.projects || {}
    const keys = Object.keys(projects)
    if (keys.length > 0) {
      this.defaultProject = projects[keys[0]].directory
    }
  }

  async getOrCreateSession(chatId: string): Promise<SessionMapping> {
    let session = this.sessions.get(chatId)

    if (!session) {
      const createResult = await this.opencode.client.session.create({
        body: {
          title: `Telegram Chat ${chatId}`,
          directory: this.getCurrentProjectDir(chatId),
        },
      })

      if (createResult.error) {
        throw new Error(`Failed to create session: ${createResult.error.message}`)
      }

      session = {
        chatId,
        sessionId: createResult.data.id,
        project: this.defaultProject,
        createdAt: Date.now(),
        compactedAt: null,
        messageCount: 0,
        mediaCount: 0,
      }

      this.sessions.set(chatId, session)
    }

    session.messageCount++
    return session
  }

  async switchProject(chatId: string, projectDir: string): Promise<void> {
    const createResult = await this.opencode.client.session.create({
      body: {
        title: `Telegram Chat ${chatId} - ${this.getProjectName(projectDir)}`,
        directory: projectDir,
      },
    })

    if (createResult.error) {
      throw new Error(`Failed to create session: ${createResult.error.message}`)
    }

    this.sessions.set(chatId, {
      chatId,
      sessionId: createResult.data.id,
      project: projectDir,
      createdAt: Date.now(),
      compactedAt: null,
      messageCount: 0,
      mediaCount: 0,
    })
  }

  updateCompaction(sessionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        session.compactedAt = Date.now()
        break
      }
    }
  }

  incrementMediaCount(chatId: string): void {
    const session = this.sessions.get(chatId)
    if (session) session.mediaCount++
  }

  getCurrentProjectDir(chatId: string): string | null {
    return this.sessions.get(chatId)?.project || this.defaultProject
  }

  getProjectName(dir: string): string {
    const projects = this.config.projects || {}
    for (const [key, project] of Object.entries(projects)) {
      if (project.directory === dir) {
        return project.name || key
      }
    }
    return dir
  }

  getStats(chatId: string): SessionStats {
    const session = this.sessions.get(chatId)
    if (!session) {
      return { exists: false }
    }

    return {
      exists: true,
      sessionId: session.sessionId,
      project: session.project,
      messageCount: session.messageCount,
      mediaCount: session.mediaCount,
      createdAt: session.createdAt,
      compactedAt: session.compactedAt,
      isCompacted: session.compactedAt !== null,
    }
  }

  getSessionBySessionId(sessionId: string): SessionMapping | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        return session
      }
    }
    return null
  }
}
