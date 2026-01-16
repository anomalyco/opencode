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
  private eventSource: EventSource | null = null
  private eventHandlers: Map<string, Set<(event: any) => void>> = new Map()

  constructor(baseURL: string = 'http://localhost:4096') {
    this.baseURL = baseURL
  }

  /**
   * Connect to event stream for real-time updates
   */
  connectEventStream(onError?: (error: Event) => void): void {
    if (this.eventSource) {
      return // Already connected
    }

    const eventURL = `${this.baseURL}/event`
    this.eventSource = new EventSource(eventURL)

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const handlers = this.eventHandlers.get(data.type)
        if (handlers) {
          handlers.forEach(handler => handler(data))
        }
      } catch (err) {
        console.error('Failed to parse event:', err)
      }
    }

    this.eventSource.onerror = (error) => {
      console.error('EventSource error:', error)
      onError?.(error)
      // Reconnect after error
      this.disconnectEventStream()
      setTimeout(() => this.connectEventStream(onError), 5000)
    }
  }

  /**
   * Disconnect from event stream
   */
  disconnectEventStream(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  /**
   * Subscribe to specific event types
   */
  onEvent(eventType: string, handler: (event: any) => void): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set())
    }
    this.eventHandlers.get(eventType)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this.eventHandlers.delete(eventType)
        }
      }
    }
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
   * Send a message - response will come through event stream
   * This method triggers the message but doesn't wait for completion
   */
  async sendMessage(request: SendMessageRequest): Promise<void> {
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

    // Read and discard the response body - updates come via event stream
    // We still need to consume the response to avoid memory leaks
    const reader = response.body?.getReader()
    if (reader) {
      while (true) {
        const { done } = await reader.read()
        if (done) break
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
