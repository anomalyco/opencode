import type {
  Session,
  Message,
  MessageWithParts,
  Config,
  Provider,
  Agent,
  ClientMessage,
  ServerMessage,
  BusEvent,
} from "../types"

/**
 * OpenCode API Client
 * Provides HTTP and WebSocket communication with OpenCode server
 */
export class OpenCodeClient {
  private baseURL: string
  private wsURL: string
  private ws: WebSocket | null = null
  private eventHandlers: Map<string, Set<(event: BusEvent) => void>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(baseURL = "/api", wsURL = "/ws") {
    this.baseURL = baseURL
    this.wsURL = wsURL
  }

  // ========================================
  // Generic HTTP Methods
  // ========================================

  async get(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseURL}${endpoint}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async post(endpoint: string, data?: any): Promise<any> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async patch(endpoint: string, data: any): Promise<any> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async delete(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: "DELETE",
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  // ========================================
  // REST API Methods
  // ========================================

  /**
   * Get all sessions
   */
  async getSessions(): Promise<Session[]> {
    const response = await fetch(`${this.baseURL}/session`)
    return response.json()
  }

  /**
   * Get a specific session
   */
  async getSession(sessionID: string): Promise<Session> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}`)
    return response.json()
  }

  /**
   * Create a new session
   */
  async createSession(opts: {
    title?: string
    agent?: string
    model?: {
      providerID: string
      modelID: string
    }
  } = {}): Promise<Session> {
    const response = await fetch(`${this.baseURL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    })
    return response.json()
  }

  /**
   * Update a session
   */
  async updateSession(sessionID: string, updates: { title?: string }): Promise<Session> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    return response.json()
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionID: string): Promise<boolean> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}`, {
      method: "DELETE",
    })
    return response.json()
  }

  /**
   * Get messages for a session
   */
  async getMessages(sessionID: string): Promise<Message[]> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}/message`)
    return response.json()
  }

  /**
   * Get a specific message
   */
  async getMessage(sessionID: string, messageID: string): Promise<MessageWithParts> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}/message/${messageID}`)
    return response.json()
  }

  /**
   * Send a prompt via REST API (non-streaming)
   */
  async sendPrompt(
    sessionID: string,
    content: string,
    opts: {
      model?: {
        providerID: string
        modelID: string
      }
      agent?: string
    } = {},
  ): Promise<MessageWithParts> {
    const response = await fetch(`${this.baseURL}/session/${sessionID}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        ...opts,
      }),
    })

    // Note: The REST endpoint returns a stream, but we're reading it as JSON here
    // For proper streaming, use WebSocket instead
    const reader = response.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let result = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }

    return JSON.parse(result)
  }

  /**
   * Get configuration
   */
  async getConfig(): Promise<Config> {
    const response = await fetch(`${this.baseURL}/config`)
    return response.json()
  }

  /**
   * Get available providers
   */
  async getProviders(): Promise<{
    providers: Provider[]
    default: Record<string, string>
  }> {
    const response = await fetch(`${this.baseURL}/config/providers`)
    return response.json()
  }

  /**
   * Get available agents
   */
  async getAgents(): Promise<Agent[]> {
    const response = await fetch(`${this.baseURL}/agent`)
    return response.json()
  }

  // ========================================
  // File Operations
  // ========================================

  /**
   * List files and directories
   */
  async listFiles(path: string): Promise<any[]> {
    const response = await fetch(`${this.baseURL}/file?path=${encodeURIComponent(path)}`)
    return response.json()
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<{ content: string; language?: string }> {
    const response = await fetch(`${this.baseURL}/file/content?path=${encodeURIComponent(path)}`)
    return response.json()
  }

  /**
   * Get project file status (git status)
   */
  async getFileStatus(): Promise<any[]> {
    const response = await fetch(`${this.baseURL}/file/status`)
    return response.json()
  }

  /**
   * Search files by name
   */
  async searchFiles(query: string): Promise<string[]> {
    const response = await fetch(`${this.baseURL}/find/file?query=${encodeURIComponent(query)}`)
    return response.json()
  }

  /**
   * Search text in files
   */
  async searchText(pattern: string): Promise<any[]> {
    const response = await fetch(`${this.baseURL}/find?pattern=${encodeURIComponent(pattern)}`)
    return response.json()
  }

  /**
   * Write file (via project API)
   */
  async writeFile(path: string, content: string): Promise<boolean> {
    const response = await fetch(`${this.baseURL}/project/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    })
    return response.json()
  }

  /**
   * Delete file (via project API)
   */
  async deleteFile(path: string): Promise<boolean> {
    const response = await fetch(`${this.baseURL}/project/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    })
    return response.json()
  }

  // ========================================
  // WebSocket Methods
  // ========================================

  /**
   * Connect to WebSocket
   */
  async connectWebSocket(
    onOpen?: () => void,
    onError?: (error: Event) => void,
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      // Use appropriate protocol based on current page protocol
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const host = window.location.host
      const wsUrl = this.wsURL.startsWith("/") ? `${protocol}//${host}${this.wsURL}` : this.wsURL

      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log("[OpenCodeClient] WebSocket connected")
        this.reconnectAttempts = 0
        onOpen?.()
        resolve(this.ws!)
      }

      this.ws.onerror = (error) => {
        console.error("[OpenCodeClient] WebSocket error:", error)
        onError?.(error)
        reject(error)
      }

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data)
      }

      this.ws.onclose = () => {
        console.log("[OpenCodeClient] WebSocket disconnected")
        this.ws = null
        this.attemptReconnect()
      }
    })
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Subscribe to a session via WebSocket
   */
  subscribeToSession(sessionID: string) {
    this.sendWebSocketMessage({
      type: "subscribe",
      sessionID,
    })
  }

  /**
   * Send a prompt via WebSocket (real-time streaming)
   */
  sendPromptViaWebSocket(
    sessionID: string,
    content: string,
    opts: {
      model?: {
        providerID: string
        modelID: string
      }
      agent?: string
    } = {},
  ) {
    this.sendWebSocketMessage({
      type: "prompt",
      sessionID,
      content,
      ...opts,
    })
  }

  /**
   * Send a ping message
   */
  ping() {
    this.sendWebSocketMessage({ type: "ping" })
  }

  /**
   * Listen to specific event types
   */
  on(eventType: string, handler: (event: BusEvent) => void) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set())
    }
    this.eventHandlers.get(eventType)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType)
      if (handlers) {
        handlers.delete(handler)
      }
    }
  }

  /**
   * Listen to all events
   */
  onAny(handler: (event: BusEvent) => void) {
    return this.on("*", handler)
  }

  // ========================================
  // Private Methods
  // ========================================

  private sendWebSocketMessage(message: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[OpenCodeClient] WebSocket not connected")
      return
    }

    this.ws.send(JSON.stringify(message))
  }

  private handleWebSocketMessage(data: string) {
    try {
      const message: ServerMessage = JSON.parse(data)

      switch (message.type) {
        case "event":
          this.emitEvent(message.data)
          break

        case "subscribed":
          console.log("[OpenCodeClient] Subscribed to session:", message.data.sessionID)
          this.emitEvent({
            type: "client.subscribed",
            properties: message.data,
          })
          break

        case "pong":
          console.log("[OpenCodeClient] Pong received")
          break

        case "error":
          console.error("[OpenCodeClient] Server error:", message.error)
          this.emitEvent({
            type: "client.error",
            properties: { error: message.error },
          })
          break

        default:
          console.warn("[OpenCodeClient] Unknown message type:", message)
      }
    } catch (error) {
      console.error("[OpenCodeClient] Failed to parse WebSocket message:", error)
    }
  }

  private emitEvent(event: BusEvent) {
    // Emit to specific event type handlers
    const handlers = this.eventHandlers.get(event.type)
    if (handlers) {
      handlers.forEach((handler) => handler(event))
    }

    // Emit to wildcard handlers
    const wildcardHandlers = this.eventHandlers.get("*")
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler(event))
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[OpenCodeClient] Max reconnection attempts reached")
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    console.log(
      `[OpenCodeClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    )

    setTimeout(() => {
      this.connectWebSocket().catch((error) => {
        console.error("[OpenCodeClient] Reconnection failed:", error)
      })
    }, delay)
  }
}

// Export singleton instance
export const client = new OpenCodeClient()
