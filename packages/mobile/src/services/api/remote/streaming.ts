import EventSource from "react-native-sse"
import { localConfigService } from "../local/config"

// Types for SSE events based on actual API structure
interface SSEEvent {
  type: string
  properties?: any
  timestamp?: string
}

interface StorageWriteEvent extends SSEEvent {
  type: "storage.write"
  properties: {
    key: string
    content: any
  }
}

interface MessageUpdatedEvent extends SSEEvent {
  type: "message.updated"
  properties: {
    info: {
      id: string
      role: string
      sessionID: string
      [key: string]: any
    }
  }
}

interface MessagePartUpdatedEvent extends SSEEvent {
  type: "message.part.updated"
  properties: {
    part: {
      id: string
      messageID: string
      sessionID: string
      type: string
      text?: string
      [key: string]: any
    }
  }
}

interface SessionUpdatedEvent extends SSEEvent {
  type: "session.updated"
  properties: {
    info: {
      id: string
      sessionID: string
      [key: string]: any
    }
  }
}

interface ServerConnectedEvent extends SSEEvent {
  type: "server.connected"
  properties: {}
}

interface SessionIdleEvent extends SSEEvent {
  type: "session.idle"
  properties: {
    sessionID: string
  }
}

type StreamEvent =
  | StorageWriteEvent
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | SessionUpdatedEvent
  | ServerConnectedEvent
  | SessionIdleEvent

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
        console.log("🔥 Raw SSE event:", event)
        console.log("🔥 Raw SSE event.data:", event.data)
        const data = JSON.parse(event.data || "{}")
        console.log("🔥 Parsed SSE data:", data)
        this.handleEvent(data)
      } catch (error) {
        console.error("Failed to parse SSE event:", error)
        console.error("Raw event data:", event.data)
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
    console.log("🔥 Handling SSE event:", event.type, event.properties)

    // Notify all listeners for this event type
    const typeListeners = this.listeners.get(event.type)
    if (typeListeners) {
      console.log(`🔥 Notifying ${typeListeners.size} listeners for type: ${event.type}`)
      typeListeners.forEach((listener) => listener(event))
    }

    // Notify all listeners for "all" events
    const allListeners = this.listeners.get("*")
    if (allListeners) {
      console.log(`🔥 Notifying ${allListeners.size} listeners for all events`)
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
      let eventSessionId: string | undefined
      if (event.type === "storage.write") {
        eventSessionId = (event as StorageWriteEvent).properties?.content?.sessionID
      } else if (event.type === "message.updated") {
        eventSessionId = (event as MessageUpdatedEvent).properties?.info?.sessionID
      } else if (event.type === "message.part.updated") {
        eventSessionId = (event as MessagePartUpdatedEvent).properties?.part?.sessionID
      }

      if (eventSessionId === sessionId) {
        listener(event)
      }
    })
  }

  subscribeToMessage(messageId: string, listener: (event: MessagePartUpdatedEvent) => void) {
    return this.subscribe("*", (event) => {
      if (
        event.type === "message.part.updated" &&
        (event as MessagePartUpdatedEvent).properties?.part?.messageID === messageId
      ) {
        listener(event as MessagePartUpdatedEvent)
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
    subscribeToMessage: (messageId: string, listener: (event: MessagePartUpdatedEvent) => void) =>
      streamingService.subscribeToMessage(messageId, listener),
    isConnected: () => streamingService.isConnected(),
    getConnectionState: () => streamingService.getConnectionState(),
  }
}
