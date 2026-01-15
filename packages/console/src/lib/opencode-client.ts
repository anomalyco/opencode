/**
 * OpenCode API Client
 *
 * Handles communication with the local OpenCode Server
 */

export interface SessionConfig {
  agent?: string
  directory?: string
}

export interface Session {
  id: string
  agent: string
  directory: string
  createdAt: string
}

export interface MessagePart {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  tool_name?: string
  tool_input?: any
  tool_result?: any
  content?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  createdAt: string
}

export interface SendMessageRequest {
  sessionId: string
  content: string
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
    const response = await fetch(`${this.baseURL}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: config.agent || 'build',
        directory: config.directory,
      }),
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
   */
  async sendMessage(
    request: SendMessageRequest,
    onChunk: (part: MessagePart) => void
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

    // Handle SSE streaming
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('No response body')
    }

    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onChunk(data)
          } catch (err) {
            console.warn('Failed to parse SSE chunk:', err)
          }
        }
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
}

// Singleton instance
export const opencode = new OpenCodeClient()
