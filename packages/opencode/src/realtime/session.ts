/**
 * Realtime Session
 *
 * Bridges client WebSocket connections with OpenAI Realtime API transport.
 * Handles message routing, state management, and function call coordination.
 */
import { RealtimeProtocol } from "./protocol"
import { RealtimeTransport } from "./transport"
import { Log } from "../util/log"

export namespace RealtimeSession {
  const log = Log.create({ service: "realtime.session" })

  // ============================================================================
  // Types
  // ============================================================================

  export type State = "idle" | "connecting" | "connected" | "disconnected" | "error"

  export interface Events {
    /** Called when session state changes */
    onStateChange?: (state: State) => void
    /** Called with JSON message to send to client WebSocket */
    onClientMessage?: (message: string) => void
    /** Called on transport or parsing errors */
    onError?: (error: Error) => void
    /** Called when a function call is received from the model */
    onFunctionCall?: (call: RealtimeProtocol.ResponseFunctionCallArgumentsDone) => void
  }

  export interface CreateOptions {
    sessionID: string
    /** OpenAI API key (required if no transport provided) */
    apiKey?: string
    /** Custom transport (for testing) */
    transport?: RealtimeTransport.Transport & {
      simulateServerEvent?: (event: RealtimeProtocol.ServerEvent) => void
      getSentEvents?: () => RealtimeProtocol.ClientEvent[]
    }
    /** OpenAI model to use */
    model?: string
  }

  export interface Session {
    readonly sessionID: string
    readonly state: State

    /** Start the realtime session (connect to OpenAI) */
    start(): Promise<void>

    /** Stop the realtime session */
    stop(): void

    /** Handle incoming message from client WebSocket */
    handleClientMessage(message: string): void

    /** Submit function call result to the model */
    submitFunctionResult(result: { call_id: string; output: string }): void

    /** Register event handlers */
    on(events: Events): void
  }

  // ============================================================================
  // Session Registry
  // ============================================================================

  const registry = new Map<string, Session>()

  export function get(sessionID: string): Session | undefined {
    return registry.get(sessionID)
  }

  export function clearRegistry(): void {
    registry.clear()
  }

  // ============================================================================
  // Implementation
  // ============================================================================

  export function create(options: CreateOptions): Session {
    const { sessionID } = options

    let state: State = "idle"
    let events: Events = {}
    let transport: RealtimeTransport.Transport

    // Create or use provided transport
    if (options.transport) {
      transport = options.transport
    } else if (options.apiKey) {
      transport = RealtimeTransport.createOpenAITransport({
        apiKey: options.apiKey,
        model: options.model,
      })
    } else {
      throw new Error("Either apiKey or transport must be provided")
    }

    const setState = (newState: State) => {
      state = newState
      events.onStateChange?.(state)
    }

    // Forward server events to client
    const handleServerEvent = (event: RealtimeProtocol.ServerEvent) => {
      // Forward to client
      const json = JSON.stringify(event)
      events.onClientMessage?.(json)

      // Handle function calls specially
      if (event.type === "response.function_call_arguments.done") {
        events.onFunctionCall?.(event)
      }
    }

    // Set up transport event handlers
    transport.on({
      onStateChange: (transportState) => {
        if (transportState === "connected") {
          setState("connected")
        } else if (transportState === "disconnected") {
          setState("disconnected")
          registry.delete(sessionID)
        } else if (transportState === "error") {
          setState("error")
        }
      },
      onServerEvent: handleServerEvent,
      onError: (error) => {
        log.error("transport error", { sessionID, error: error.message })
        setState("error")
        events.onError?.(error)
      },
    })

    const session: Session = {
      get sessionID() {
        return sessionID
      },

      get state() {
        return state
      },

      async start() {
        if (state !== "idle") {
          log.warn("session already started", { sessionID, state })
          return
        }

        setState("connecting")
        log.info("starting realtime session", { sessionID })

        try {
          await transport.connect()
          log.info("realtime session connected", { sessionID })
        } catch (error) {
          log.error("failed to connect", { sessionID, error })
          setState("error")
          throw error
        }
      },

      stop() {
        log.info("stopping realtime session", { sessionID })
        transport.disconnect()
        setState("disconnected")
        registry.delete(sessionID)
      },

      handleClientMessage(message: string) {
        if (state !== "connected") {
          log.warn("ignoring message - not connected", { sessionID, state })
          return
        }

        try {
          const parsed = JSON.parse(message)
          const event = RealtimeProtocol.ClientEvent.parse(parsed)

          log.debug("routing client message to OpenAI", { sessionID, type: event.type })
          transport.send(event)
        } catch (error) {
          log.warn("failed to parse/validate client message", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
          // Don't throw - gracefully ignore invalid messages
        }
      },

      submitFunctionResult(result: { call_id: string; output: string }) {
        if (state !== "connected") {
          log.warn("cannot submit function result - not connected", { sessionID })
          return
        }

        const event: RealtimeProtocol.ClientEvent = {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: result.call_id,
            output: result.output,
          },
        }

        transport.send(event)

        // Continue response generation after function result
        transport.send({ type: "response.create" })
      },

      on(newEvents: Events) {
        events = { ...events, ...newEvents }
      },
    }

    // Register in registry
    registry.set(sessionID, session)

    return session
  }
}
