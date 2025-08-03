import EventSource from "react-native-sse"
import { localConfigService } from "../local/config"

// Types for SSE events based on the API
interface SSEEvent {
  type: string
  data: any
  timestamp: string
}

interface MessageStreamEvent extends SSEEvent {
  type: "message.part" | "message.complete" | "message.error"
  data: {
    sessionId: string
    messageId: string
    partId?: string
    content?: string
    error?: string
  }
}

interface SessionStreamEvent extends SSEEvent {
  type: "session.updated" | "session.deleted"
  data: {
    sessionId: string
    [key: string]: any
  }
}

type StreamEvent = MessageStreamEvent | SessionStreamEvent

export class StreamingService {
  private static instance: StreamingService
  private eventSource: EventSource<any> | null = null
  private listeners: Map<string, Set<(event: StreamEvent) => void>> = new Map()
  private connected: boolean = false

  private constructor() {}

  static getInstance(): StreamingService {
    if (!StreamingService.instance) {
      StreamingService.instance = new StreamingService()
    }
    return StreamingService.instance
  }

  async connect() {
    if (this.eventSource) {
      this.disconnect()
    }

    const serverUrl = await localConfigService.getServerUrl()
    if (!serverUrl) {
      throw new Error("No server URL configured")
    }

    this.eventSource = new EventSource(`${serverUrl}/event`, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    })

    this.eventSource.addEventListener("open", () => {
      console.log("SSE connection opened")
      this.connected = true
      localConfigService.updateConnectionStatus("connected")
    })

    this.eventSource.addEventListener("message", (event: any) => {
      try {
        const data = JSON.parse(event.data || "{}")
        this.handleEvent(data)
      } catch (error) {
        console.error("Failed to parse SSE event:", error)
      }
    })

    this.eventSource.addEventListener("error", (error: any) => {
      console.error("SSE connection error:", error)
      this.connected = false
      localConfigService.updateConnectionStatus("disconnected")

      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (!this.connected) {
          this.connect()
        }
      }, 5000)
    })

    this.eventSource.addEventListener("close", () => {
      console.log("SSE connection closed")
      this.connected = false
      localConfigService.updateConnectionStatus("disconnected")
    })
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
      this.connected = false
    }
  }

  private handleEvent(event: StreamEvent) {
    // Notify all listeners for this event type
    const typeListeners = this.listeners.get(event.type)
    if (typeListeners) {
      typeListeners.forEach((listener) => listener(event))
    }

    // Notify all listeners for "all" events
    const allListeners = this.listeners.get("*")
    if (allListeners) {
      allListeners.forEach((listener) => listener(event))
    }
  }

  // Subscribe to specific event types or "*" for all events
  subscribe(eventType: string, listener: (event: StreamEvent) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    // Return unsubscribe function
    return () => {
      const typeListeners = this.listeners.get(eventType)
      if (typeListeners) {
        typeListeners.delete(listener)
        if (typeListeners.size === 0) {
          this.listeners.delete(eventType)
        }
      }
    }
  }

  // Convenience methods for common subscriptions
  subscribeToSession(sessionId: string, listener: (event: StreamEvent) => void) {
    return this.subscribe("*", (event) => {
      if ("sessionId" in event.data && event.data.sessionId === sessionId) {
        listener(event)
      }
    })
  }

  subscribeToMessage(messageId: string, listener: (event: MessageStreamEvent) => void) {
    return this.subscribe("*", (event) => {
      if (event.type.startsWith("message.") && "messageId" in event.data && event.data.messageId === messageId) {
        listener(event as MessageStreamEvent)
      }
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  getConnectionState(): "connecting" | "open" | "closed" {
    return this.connected ? "open" : "closed"
  }
}

export const streamingService = StreamingService.getInstance()

// React hook for using streaming in components
export function useStreaming() {
  return {
    connect: () => streamingService.connect(),
    disconnect: () => streamingService.disconnect(),
    subscribe: (eventType: string, listener: (event: StreamEvent) => void) =>
      streamingService.subscribe(eventType, listener),
    subscribeToSession: (sessionId: string, listener: (event: StreamEvent) => void) =>
      streamingService.subscribeToSession(sessionId, listener),
    subscribeToMessage: (messageId: string, listener: (event: MessageStreamEvent) => void) =>
      streamingService.subscribeToMessage(messageId, listener),
    isConnected: () => streamingService.isConnected(),
    getConnectionState: () => streamingService.getConnectionState(),
  }
}
