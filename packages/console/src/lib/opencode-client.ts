/**
 * OpenCode API Client
 *
 * Handles communication with the local OpenCode Server
 */

export interface SessionConfig {
  agent?: string
  directory?: string
  providerID?: string
  modelID?: string
}

export interface Session {
  id: string
  agent: string
  directory: string
  createdAt: string
}

/**
 * OpenCode MessageV2 Part types
 */
export interface MessagePart {
  id: string
  sessionID: string
  messageID: string
  type: string
  // text part
  text?: string
  synthetic?: boolean
  // tool part
  tool?: string
  callID?: string
  state?: {
    status: 'pending' | 'running' | 'completed' | 'error'
    input?: any
    output?: any
    metadata?: any
    error?: any
  }
  // reasoning part
  time?: { start: number; end?: number }
  // file part
  mime?: string
  filename?: string
  url?: string
  // step part
  step?: string
  title?: string
  // generic
  metadata?: Record<string, any>
}

export interface MessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: { created: number; completed?: number }
  modelID?: string
  providerID?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  createdAt: string
  info?: MessageInfo
}

export interface SessionMessageResponse {
  info: MessageInfo
  parts: MessagePart[]
}

export interface SendMessageRequest {
  sessionId: string
  content: string
}

export interface ProviderModel {
  id: string
  name: string
  family?: string
  cost?: {
    input: number
    output: number
  }
  limit?: {
    context: number
    output: number
  }
  status?: 'alpha' | 'beta' | 'deprecated'
}

export interface Provider {
  id: string
  name: string
  env: string[]
  models: Record<string, ProviderModel>
}

export interface ProvidersResponse {
  all: Provider[]
  default: Record<string, string>
  connected: string[]
}

export class OpenCodeClient {
  private baseURL: string

  constructor(baseURL: string = 'http://localhost:4096') {
    this.baseURL = baseURL
  }

  /**
   * Check if OpenCode Server is running
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/global/health`)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Create a new session
   */
  async createSession(config: SessionConfig): Promise<Session> {
    const body: Record<string, any> = {
      agent: config.agent || 'build',
      directory: config.directory,
    }

    // Add provider/model selection if specified
    if (config.providerID && config.modelID) {
      body.providerID = config.providerID
      body.modelID = config.modelID
    }

    const response = await fetch(`${this.baseURL}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${this.baseURL}/session/${sessionId}`)

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get messages for a session
   */
  async getMessages(sessionId: string): Promise<Message[]> {
    const response = await fetch(`${this.baseURL}/session/${sessionId}/message`)

    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Send a message and receive streaming response
   * The server returns JSON, not SSE - it streams the complete response
   */
  async sendMessage(
    request: SendMessageRequest,
    onResponse: (response: SessionMessageResponse) => void
  ): Promise<void> {
    const response = await fetch(
      `${this.baseURL}/session/${request.sessionId}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: request.content }],
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`)
    }

    // The server streams JSON - collect all chunks
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('No response body')
    }

    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })
    }

    // Parse the complete JSON response
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer)
        onResponse(data)
      } catch (err) {
        console.error('Failed to parse response:', err, buffer)
        throw new Error('Failed to parse server response')
      }
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/session/${sessionId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.statusText}`)
    }
  }

  /**
   * Get all available providers and models
   */
  async getProviders(): Promise<ProvidersResponse> {
    const response = await fetch(`${this.baseURL}/provider`)

    if (!response.ok) {
      throw new Error(`Failed to get providers: ${response.statusText}`)
    }

    return response.json()
  }
}

// Singleton instance
export const opencode = new OpenCodeClient()
