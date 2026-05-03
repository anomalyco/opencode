/**
 * Veritly Relay SDK
 * 
 * Client for the WebSocket relay that forwards commands from backend (agents)
 * to browser for execution. The browser executes Univer SDK commands and
 * returns responses through the relay.
 * 
 * Architecture:
 *   Backend (Agent) -> Relay -> Browser -> executes -> Browser -> Relay -> Backend
 */

import { Log } from "../util/log"

const log = Log.create({ service: "relay-sdk" })

export interface RelayConfig {
  relayUrl: string  // ws://host:port/relay/ws?role=agent
  timeout?: number
}

export interface RelayRequest {
  id: string
  op: string
  params?: unknown
  traceparent?: string
}

export interface RelayResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
  traceparent?: string
}

export type RelayMessage = RelayRequest | RelayResponse

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = "RelayError"
  }
}

export class RelaySDK {
  private ws: WebSocket | null = null
  private config: RelayConfig
  private pending = new Map<string, {
    resolve: (value: RelayResponse) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 3
  private connected = false
  private messageQueue: RelayRequest[] = []

  constructor(config: RelayConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    }
  }

  /**
   * Connect to the relay as an agent
   */
  async connect(): Promise<void> {
    if (this.connected) {
      log.debug("Already connected to relay")
      return
    }

    return new Promise((resolve, reject) => {
      const url = this.config.relayUrl
      log.info("Connecting to relay", { url })

      try {
        this.ws = new WebSocket(url)

        this.ws.onopen = () => {
          log.info("Connected to relay")
          this.connected = true
          this.reconnectAttempts = 0
          
          // Flush any queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()
            if (msg) this.send(msg)
          }
          
          resolve()
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }

        this.ws.onerror = (error) => {
          log.error("WebSocket error", { error })
          reject(new RelayError("WebSocket error", "WS_ERROR"))
        }

        this.ws.onclose = (event) => {
          log.info("Disconnected from relay", { code: event.code, reason: event.reason })
          this.connected = false
          
          // Reject all pending requests
          for (const [id, pending] of this.pending.entries()) {
            pending.reject(new RelayError("Connection closed", "CONN_CLOSED"))
            clearTimeout(pending.timeout)
          }
          this.pending.clear()

          // Attempt reconnect if not clean close
          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            log.info("Attempting reconnect", { attempt: this.reconnectAttempts })
            setTimeout(() => this.connect().catch(() => {}), 1000 * this.reconnectAttempts)
          }
        }
      } catch (error) {
        reject(new RelayError(`Failed to connect: ${error}`, "CONN_FAILED"))
      }
    })
  }

  /**
   * Disconnect from relay
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, "client disconnect")
      this.ws = null
    }
    this.connected = false
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Send a request to the browser through the relay
   * Returns a promise that resolves with the browser's response
   */
  async request(op: string, params?: unknown): Promise<unknown> {
    const id = this.generateId()
    const request: RelayRequest = {
      id,
      op,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new RelayError(`Request timeout: ${op}`, "TIMEOUT"))
      }, this.config.timeout)

      this.pending.set(id, {
        resolve: (resp) => resolve(resp.result),
        reject,
        timeout,
      })

      this.send(request)
    })
  }

  /**
   * Send a message (request or response)
   */
  private send(msg: RelayMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if not connected
      if ("op" in msg) {
        this.messageQueue.push(msg)
      }
      return
    }

    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Handle incoming messages from relay
   */
  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as RelayResponse

      if (!msg.id) {
        log.warn("Received message without id", { data })
        return
      }

      // Check if this is a response to a pending request
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        clearTimeout(pending.timeout)

        if (msg.ok) {
          pending.resolve(msg)
        } else {
          pending.reject(new RelayError(msg.error || "Request failed", "REQUEST_FAILED"))
        }
        return
      }

      // Could be a message from browser (if we're acting as browser side)
      log.debug("Received message (no pending)", { id: msg.id, ok: msg.ok })
    } catch (error) {
      log.error("Failed to handle message", { error, data })
    }
  }

  /**
   * Generate unique request ID
   */
  private generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Execute Univer SDK command through browser
   */
  async executeUniverCommand(command: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.request("univer.execute", {
      command,
      params,
    })
  }

  /**
   * Get relay health status
   */
  async health(): Promise<{ ok: boolean; browserConnected: boolean; agentCount: number }> {
    const url = this.config.relayUrl.replace("ws://", "http://").replace("wss://", "https://").split("?")[0].replace("/relay/ws", "/relay/readyz")
    
    const response = await fetch(url)
    if (!response.ok) {
      throw new RelayError("Health check failed", "HEALTH_FAILED")
    }
    
    return response.json()
  }
}

// Factory
export const Relay = {
  create(config: RelayConfig): RelaySDK {
    return new RelaySDK(config)
  },
}
