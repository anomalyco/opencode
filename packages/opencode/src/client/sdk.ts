/**
 * OpenCode API Client SDK
 * 
 * Type-safe client for the OpenCode API. Can be used by:
 * - Frontend applications
 * - Integration tests
 * - External integrations
 */

import { Log } from "../util/log"

const log = Log.create({ service: "opencode-client" })

export interface ClientConfig {
  baseUrl: string
  /** Optional tenant user ID for authentication (tests only) */
  tenantUserId?: string
}

export interface Project {
  id: string
  name?: string
  tenantUserId: string
  time: {
    created: number
    updated: number
  }
}

export interface Session {
  id: string
  slug: string
  projectID: string
  parentID?: string
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
  }
}

export interface Message {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    content: string
    time: {
      created: number
    }
  }
  parts: Array<{
    id: string
    messageID: string
    sessionID: string
    type: string
    content: string
  }>
}

export class OpenCodeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "OpenCodeError"
  }
}

export class OpenCodeClient {
  private baseUrl: string
  private tenantUserId?: string

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.tenantUserId = config.tenantUserId
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    }

    // Add tenant header for test authentication
    if (this.tenantUserId) {
      requestHeaders["x-tenant-user-id"] = this.tenantUserId
    }

    log.debug("API request", { method, path, url })

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new OpenCodeError(
        `API error: ${response.status} ${errorText}`,
        "API_ERROR",
        response.status,
      )
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as T
    }

    return response.json()
  }

  // ============ Projects ============

  async createProject(input: {
    name: string
  }): Promise<Project> {
    // Project creation goes through the project init API
    const result = await this.request<Project>(
      "POST",
      "/project",
      {
        name: input.name,
        tenantUserId: this.tenantUserId || "test_user",
      },
    )
    return result
  }

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/project")
  }

  async getProject(projectId: string): Promise<Project> {
    return this.request<Project>("GET", `/project/${projectId}`)
  }

  // ============ Sessions ============

  async createSession(input: {
    projectId: string
    title?: string
    parentId?: string
  }): Promise<Session> {
    return this.request<Session>(
      "POST",
      "/session",
      {
        projectID: input.projectId,
        title: input.title,
        parentID: input.parentId,
      },
    )
  }

  async listSessions(projectId?: string): Promise<Session[]> {
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""
    return this.request<Session[]>("GET", `/session${query}`)
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>("GET", `/session/${sessionId}`)
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.request<boolean>("DELETE", `/session/${sessionId}`)
  }

  // ============ Messages ============

  async sendMessage(input: {
    sessionId: string
    content: string
    agent?: string
  }): Promise<Message> {
    return this.request<Message>(
      "POST",
      `/session/${input.sessionId}/message`,
      {
        content: input.content,
        agent: input.agent,
      },
    )
  }

  async listMessages(sessionId: string, limit?: number): Promise<Message[]> {
    const query = limit ? `?limit=${limit}` : ""
    return this.request<Message[]>("GET", `/session/${sessionId}/message${query}`)
  }

  // ============ Health ============

  async health(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("GET", "/health")
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health()
      return health.ok
    } catch {
      return false
    }
  }
}

// Factory
export const OpenCode = {
  create(config: ClientConfig): OpenCodeClient {
    return new OpenCodeClient(config)
  },
}
