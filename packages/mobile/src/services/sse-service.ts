/**
 * SSE Service - Background streaming with multi-session support
 * Handles Server-Sent Events for real-time updates
 */

import EventSource from "react-native-sse"
import db from "@/db"
import { projects } from "@/db/schema"
import { eq } from "drizzle-orm"
import type { SSEEvent, SSEEventType, SessionState } from "@/types/opencode-types"

export type SSEEventCallback = (event: SSEEvent) => void
export type SessionStateCallback = (sessionId: string, state: SessionState) => void

export interface SSEServiceConfig {
  reconnectInterval?: number
  maxReconnectAttempts?: number
  heartbeatInterval?: number
  sessionTimeout?: number
}

export class SSEService {
  private config: SSEServiceConfig
  private eventSource: EventSource | null = null
  private connected = false
  private reconnectAttempts = 0
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null

  // Event subscriptions
  private eventSubscriptions = new Map<string, Set<SSEEventCallback>>()
  private sessionSubscriptions = new Map<string, Set<SSEEventCallback>>()

  // Session state tracking
  private sessionStates = new Map<string, SessionState>()

  // Activity tracking
  private lastActivity = new Map<string, number>()
  private sessionTimeouts = new Map<string, number>()

  constructor(config: SSEServiceConfig = {}) {
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      sessionTimeout: 300000, // 5 minutes
      ...config,
    }
  }

  /**
   * Connect to SSE stream
   */
  async connect(): Promise<void> {
    if (this.connected || this.eventSource) {
      return
    }

    try {
      // Get the active project's server URL
      const activeProject = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1)
      if (!activeProject[0] || activeProject[0].connectionStatus !== "connected") {
        this.scheduleReconnect()
        return
      }

      const serverUrl = activeProject[0].serverUrl

      const sseUrl = `${serverUrl}/event`
      console.log("SSE: Connecting to:", sseUrl)

      this.eventSource = new EventSource(sseUrl, {
        pollingInterval: 0, // Disable automatic reconnections, we handle them manually
      })

      this.eventSource.addEventListener("open", (event) => {
        console.log("SSE: Connection opened", event)
        if (event.type === "open") {
          this.connected = true
          this.reconnectAttempts = 0
          this.startHeartbeat()
        }
      })

      this.eventSource.addEventListener("message", (event) => {
        console.log("SSE: Message received", event.type, event.data)
        if (event.type === "message") {
          try {
            const sseEvent: SSEEvent = JSON.parse(event.data || "{}")

            this.handleEvent(sseEvent)
          } catch (error) {
            console.error("Failed to connect to SSE:", error)
            console.error("SSE URL was:", sseUrl)
            this.scheduleReconnect()
          }
        }
      })

      this.eventSource.addEventListener("error", (event) => {
        console.log("SSE: Error occurred", event.type, event)
        if (event.type === "error") {
          this.handleConnectionError()
        } else if (event.type === "exception") {
          this.handleConnectionError()
        }
      })

      this.eventSource.addEventListener("close", (event) => {
        if (event.type === "close") {
          this.handleConnectionError()
        }
      })
    } catch (error) {
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.removeAllEventListeners()
      this.eventSource.close()
      this.eventSource = null
    }

    this.connected = false
    this.clearTimers()
    this.clearSessionTimeouts()
  }

  /**
   * Subscribe to specific event types
   */
  subscribe(eventType: SSEEventType | "*", callback: SSEEventCallback): () => void {
    if (!this.eventSubscriptions.has(eventType)) {
      this.eventSubscriptions.set(eventType, new Set())
    }

    this.eventSubscriptions.get(eventType)!.add(callback)

    // Auto-connect if not already connected
    if (!this.connected) {
      this.connect().catch(() => {})
    }

    return () => {
      const callbacks = this.eventSubscriptions.get(eventType)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.eventSubscriptions.delete(eventType)
        }
      }
    }
  }

  /**
   * Subscribe to events for a specific session
   */
  subscribeToSession(sessionId: string, callback: SSEEventCallback): () => void {
    if (!this.sessionSubscriptions.has(sessionId)) {
      this.sessionSubscriptions.set(sessionId, new Set())
    }

    this.sessionSubscriptions.get(sessionId)!.add(callback)

    // Initialize session state if not exists
    if (!this.sessionStates.has(sessionId)) {
      this.sessionStates.set(sessionId, {
        id: sessionId,
        isActive: false,
        isStreaming: false,
        lastActivity: Date.now(),
      })
    }

    // Auto-connect if not already connected
    if (!this.connected) {
      this.connect().catch(() => {})
    }

    return () => {
      const callbacks = this.sessionSubscriptions.get(sessionId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.sessionSubscriptions.delete(sessionId)
          this.cleanupSession(sessionId)
        }
      }
    }
  }

  /**
   * Get current session state
   */
  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessionStates.get(sessionId)
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const state = this.sessionStates.get(sessionId)
    return state?.isActive || false
  }

  /**
   * Check if connection is active
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Handle incoming SSE events
   */
  private handleEvent(sseEvent: SSEEvent): void {
    // Update session activity
    this.updateSessionActivity(sseEvent)

    // Update session state based on event
    this.updateSessionState(sseEvent)

    // Notify global event subscribers
    this.notifyEventSubscribers("*", sseEvent)
    this.notifyEventSubscribers(sseEvent.type, sseEvent)

    // Notify session-specific subscribers
    const sessionId = this.extractSessionId(sseEvent)
    if (sessionId) {
      this.notifySessionSubscribers(sessionId, sseEvent)
    }
  }

  /**
   * Update session activity tracking
   */
  private updateSessionActivity(sseEvent: SSEEvent): void {
    const sessionId = this.extractSessionId(sseEvent)
    if (sessionId) {
      this.lastActivity.set(sessionId, Date.now())
      this.resetSessionTimeout(sessionId)
    }
  }

  /**
   * Update session state based on event
   */
  private updateSessionState(sseEvent: SSEEvent): void {
    const sessionId = this.extractSessionId(sseEvent)
    if (!sessionId) return

    const currentState = this.sessionStates.get(sessionId) || {
      id: sessionId,
      isActive: false,
      isStreaming: false,
      lastActivity: Date.now(),
    }

    const newState = { ...currentState }

    switch (sseEvent.type) {
      case "session.idle":
        newState.isStreaming = false
        newState.isActive = false
        break

      case "session.error":
        newState.isStreaming = false
        newState.error = (sseEvent as any).properties?.error
        break

      case "message.updated":
      case "message.part.updated":
        newState.isActive = true
        newState.isStreaming = true
        break

      case "session.updated":
        newState.isActive = true
        break

      case "session.deleted":
        this.cleanupSession(sessionId)
        return
    }

    newState.lastActivity = Date.now()
    this.sessionStates.set(sessionId, newState)
  }

  /**
   * Extract session ID from event
   */
  private extractSessionId(sseEvent: SSEEvent): string | null {
    const properties = sseEvent.properties as any
    const sessionId =
      properties?.sessionID ||
      properties?.sessionId ||
      properties?.info?.sessionID ||
      properties?.part?.sessionID ||
      null

    return sessionId
  }

  /**
   * Notify event subscribers
   */
  private notifyEventSubscribers(eventType: string, sseEvent: SSEEvent): void {
    const callbacks = this.eventSubscriptions.get(eventType)
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(sseEvent)
        } catch (error) {}
      })
    }
  }

  /**
   * Notify session subscribers
   */
  private notifySessionSubscribers(sessionId: string, sseEvent: SSEEvent): void {
    const callbacks = this.sessionSubscriptions.get(sessionId)
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(sseEvent)
        } catch (error) {}
      })
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(): void {
    this.connected = false
    this.clearTimers()

    if (this.eventSource) {
      this.eventSource.removeAllEventListeners()
      this.eventSource.close()
      this.eventSource = null
    }

    this.scheduleReconnect()
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      return
    }

    this.reconnectAttempts++
    const delay = this.config.reconnectInterval! * Math.pow(2, this.reconnectAttempts - 1)

    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch(() => {})
    }, delay)
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.connected) {
        this.clearTimers()
        return
      }
    }, this.config.heartbeatInterval!)
  }

  /**
   * Reset session timeout
   */
  private resetSessionTimeout(sessionId: string): void {
    const existingTimeout = this.sessionTimeouts.get(sessionId)
    if (existingTimeout) {
      window.clearTimeout(existingTimeout)
    }

    const timeout = window.setTimeout(() => {
      this.handleSessionTimeout(sessionId)
    }, this.config.sessionTimeout!)

    this.sessionTimeouts.set(sessionId, timeout)
  }

  /**
   * Handle session timeout
   */
  private handleSessionTimeout(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      const newState = {
        ...state,
        isActive: false,
        isStreaming: false,
      }
      this.sessionStates.set(sessionId, newState)
    }
  }

  /**
   * Cleanup session resources
   */
  private cleanupSession(sessionId: string): void {
    this.sessionStates.delete(sessionId)
    this.lastActivity.delete(sessionId)

    const timeout = this.sessionTimeouts.get(sessionId)
    if (timeout) {
      window.clearTimeout(timeout)
      this.sessionTimeouts.delete(sessionId)
    }
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Clear all session timeouts
   */
  private clearSessionTimeouts(): void {
    this.sessionTimeouts.forEach((timeout) => window.clearTimeout(timeout))
    this.sessionTimeouts.clear()
  }
}

// Singleton instance
export const sseService = new SSEService()

/**
 * React hook for using SSE service
 */
export const useSSEService = () => {
  return {
    connect: () => sseService.connect(),
    disconnect: () => sseService.disconnect(),
    subscribe: (eventType: SSEEventType | "*", callback: SSEEventCallback) => sseService.subscribe(eventType, callback),
    subscribeToSession: (sessionId: string, callback: SSEEventCallback) =>
      sseService.subscribeToSession(sessionId, callback),
    getSessionState: (sessionId: string) => sseService.getSessionState(sessionId),
    isSessionActive: (sessionId: string) => sseService.isSessionActive(sessionId),
    isConnected: () => sseService.isConnected(),
  }
}
