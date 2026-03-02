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
    private client: any,
    private config: any,
  ) {
    this.loadDefaultProject()
  }

  getProjects(): Record<string, { name: string; directory: string }> {
    return this.config.projects || {}
  }

  getProjectByKeyword(keyword: string): { key: string; name: string; directory: string } | null {
    const projects = this.getProjects()
    const lowerKeyword = keyword.toLowerCase()

    for (const [key, project] of Object.entries(projects)) {
      if (key.includes(lowerKeyword) || project.name?.toLowerCase().includes(lowerKeyword)) {
        return { key, name: project.name, directory: project.directory }
      }
    }

    return null
  }

  getCurrentProject(): { key: string | null; name: string | null; directory: string | null } {
    const projects = this.getProjects()
    for (const [key, project] of Object.entries(projects)) {
      if (project.directory === this.defaultProject) {
        return { key, name: project.name, directory: project.directory }
      }
    }
    return { key: null, name: null, directory: this.defaultProject }
  }

  private loadDefaultProject(): void {
    const projects = this.config.projects || {}
    const keys = Object.keys(projects)
    console.log("📁 Loading default project, projects:", JSON.stringify(projects, null, 2))
    if (keys.length > 0) {
      this.defaultProject = projects[keys[0]].directory
      console.log("✅ Default project set:", this.defaultProject)
    } else {
      console.log("⚠️  No projects found in config")
    }
  }

  async getOrCreateSession(chatId: string): Promise<SessionMapping> {
    let session = this.sessions.get(chatId)

    if (!session) {
      const projectDir = this.getCurrentProjectDir(chatId)
      console.log("🔄 [Session] getOrCreateSession - creating new session for chatId:", chatId)
      console.log("🔄 [Session] - project directory:", projectDir)
      console.log("🔄 [Session] - client available:", !!this.client)
      console.log("🔄 [Session] - client.session available:", !!this.client?.session)
      console.log("🔄 [Session] - calling client.session.create...")

      let createResult: any
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout after 10s")), 10000),
        )
        const createPromise = this.client.session.create({
          title: `Telegram Chat ${chatId}`,
          directory: projectDir,
        })
        createResult = (await Promise.race([createPromise, timeoutPromise])) as any
      } catch (error) {
        console.log("🔄 [Session] ERROR calling create:", (error as Error).message)
        console.log("🔄 [Session] ERROR stack:", (error as Error).stack)
        throw error
      }

      console.log("🔄 [Session] session.create result:", createResult.error ? "ERROR" : "OK")
      if (createResult.error) {
        console.log("🔄 [Session] ERROR:", createResult.error)
      } else {
        console.log("🔄 [Session] created session ID:", createResult.data.id)
        console.log("🔄 [Session] created session directory:", createResult.data.directory)
      }

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
    console.log("🔄 [Session] switchProject called:", chatId, "->", projectDir)

    const createResult = await this.client.session.create({
      title: `Telegram Chat ${chatId} - ${this.getProjectName(projectDir)}`,
      directory: projectDir,
    })

    console.log("🔄 [Session] session.create result:", createResult.error ? "ERROR" : "OK")

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

  clearSession(chatId: string): void {
    this.sessions.delete(chatId)
  }
}
