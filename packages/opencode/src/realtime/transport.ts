/**
 * Realtime Transport Layer
 *
 * Provides an abstraction over WebSocket connections for realtime audio streaming.
 * Supports OpenAI Realtime API and can be extended for other providers.
 */
import { RealtimeProtocol } from "./protocol"

export namespace RealtimeTransport {
  // ============================================================================
  // Transport Interface
  // ============================================================================

  export type ConnectionState = "disconnected" | "connecting" | "connected" | "error"

  export interface Events {
    onStateChange?: (state: ConnectionState) => void
    onServerEvent?: (event: RealtimeProtocol.ServerEvent) => void
    onError?: (error: Error) => void
  }

  export interface Transport {
    /** Current connection state */
    readonly state: ConnectionState

    /** Connect to the realtime server */
    connect(): Promise<void>

    /** Disconnect from the server */
    disconnect(): void

    /** Send a client event to the server */
    send(event: RealtimeProtocol.ClientEvent): void

    /** Register event handlers */
    on(events: Events): void
  }

  export interface OpenAIConfig {
    apiKey: string
    model?: string
    baseUrl?: string
  }

  // ============================================================================
  // OpenAI Realtime Transport
  // ============================================================================

  export function createOpenAITransport(config: OpenAIConfig): Transport {
    const model = config.model ?? "gpt-4o-realtime-preview"
    const baseUrl = config.baseUrl ?? "wss://api.openai.com/v1/realtime"

    let ws: WebSocket | null = null
    let state: ConnectionState = "disconnected"
    let events: Events = {}

    const setState = (newState: ConnectionState) => {
      state = newState
      events.onStateChange?.(state)
    }

    const handleMessage = (data: string) => {
      try {
        const event = RealtimeProtocol.parseServerEvent(data)
        events.onServerEvent?.(event)
      } catch (err) {
        events.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }

    return {
      get state() {
        return state
      },

      async connect() {
        if (state === "connected" || state === "connecting") {
          return
        }

        setState("connecting")

        return new Promise<void>((resolve, reject) => {
          const url = `${baseUrl}?model=${encodeURIComponent(model)}`

          ws = new WebSocket(url, {
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "OpenAI-Beta": "realtime=v1",
            },
          } as any) // Bun WebSocket supports headers

          ws.onopen = () => {
            setState("connected")
            resolve()
          }

          ws.onerror = (err) => {
            const error = new Error("WebSocket error")
            setState("error")
            events.onError?.(error)
            reject(error)
          }

          ws.onclose = () => {
            setState("disconnected")
            ws = null
          }

          ws.onmessage = (event) => {
            handleMessage(event.data as string)
          }
        })
      },

      disconnect() {
        if (ws) {
          ws.close()
          ws = null
        }
        setState("disconnected")
      },

      send(event: RealtimeProtocol.ClientEvent) {
        if (!ws || state !== "connected") {
          throw new Error("Not connected")
        }
        const json = RealtimeProtocol.serializeClientEvent(event)
        ws.send(json)
      },

      on(newEvents: Events) {
        events = { ...events, ...newEvents }
      },
    }
  }

  // ============================================================================
  // Mock Transport (for testing)
  // ============================================================================

  export interface MockTransportOptions {
    /** Auto-respond to session.update with session.updated */
    autoRespond?: boolean
  }

  export function createMockTransport(options: MockTransportOptions = {}): Transport & {
    /** Simulate receiving a server event */
    simulateServerEvent(event: RealtimeProtocol.ServerEvent): void
    /** Get all sent client events */
    getSentEvents(): RealtimeProtocol.ClientEvent[]
    /** Simulate connection error */
    simulateError(error: Error): void
    /** Simulate disconnect */
    simulateDisconnect(): void
  } {
    let state: ConnectionState = "disconnected"
    let events: Events = {}
    const sentEvents: RealtimeProtocol.ClientEvent[] = []

    const setState = (newState: ConnectionState) => {
      state = newState
      events.onStateChange?.(state)
    }

    return {
      get state() {
        return state
      },

      async connect() {
        setState("connecting")
        // Simulate async connection
        await new Promise((resolve) => setTimeout(resolve, 0))
        setState("connected")

        // Simulate session.created on connect
        if (options.autoRespond) {
          setTimeout(() => {
            events.onServerEvent?.({
              type: "session.created",
              session: {},
            })
          }, 0)
        }
      },

      disconnect() {
        setState("disconnected")
      },

      send(event: RealtimeProtocol.ClientEvent) {
        if (state !== "connected") {
          throw new Error("Not connected")
        }
        sentEvents.push(event)

        // Auto-respond to session.update
        if (options.autoRespond && event.type === "session.update") {
          setTimeout(() => {
            events.onServerEvent?.({
              type: "session.updated",
              session: event.session,
            })
          }, 0)
        }
      },

      on(newEvents: Events) {
        events = { ...events, ...newEvents }
      },

      // Mock-specific methods
      simulateServerEvent(event: RealtimeProtocol.ServerEvent) {
        events.onServerEvent?.(event)
      },

      getSentEvents() {
        return [...sentEvents]
      },

      simulateError(error: Error) {
        setState("error")
        events.onError?.(error)
      },

      simulateDisconnect() {
        setState("disconnected")
      },
    }
  }
}
