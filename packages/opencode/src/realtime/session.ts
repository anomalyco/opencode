/**
 * Realtime Session
 *
 * Bridges client WebSocket connections with OpenAI Realtime API transport.
 * Handles message routing, state management, and function call coordination.
 */
import { RealtimeProtocol } from "./protocol"
import { RealtimeTransport } from "./transport"
import { RealtimeTools } from "./tools"
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
    /** Called when a tool execution starts */
    onToolExecutionStart?: (call_id: string, name: string) => void
    /** Called when a tool execution completes */
    onToolExecutionComplete?: (call_id: string, name: string, output: string) => void
    /** Called when a tool execution is interrupted */
    onToolInterrupted?: (call_id: string, name: string) => void
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
    /** Tools to make available (will be auto-executed) */
    tools?: RealtimeTools.ToolInfo[]
    /** Whether to auto-execute tools (default: true if tools provided) */
    autoExecuteTools?: boolean
    /** Session configuration to send on connect */
    sessionConfig?: Partial<RealtimeProtocol.SessionConfig>
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

    /** Cancel all pending tool executions (for interruption) */
    cancelPendingTools(): void

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
    const autoExecuteTools = options.autoExecuteTools ?? (options.tools && options.tools.length > 0)

    let state: State = "idle"
    let events: Events = {}
    let transport: RealtimeTransport.Transport
    let toolExecutor: RealtimeTools.ToolExecutor | undefined

    // Create tool executor if tools provided
    if (options.tools && options.tools.length > 0) {
      toolExecutor = RealtimeTools.createToolExecutor(options.tools)
    }

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

    // Auto-execute tool calls
    const executeToolCall = async (call: RealtimeProtocol.ResponseFunctionCallArgumentsDone) => {
      if (!toolExecutor || !autoExecuteTools) return

      log.info("auto-executing tool", { sessionID, name: call.name, call_id: call.call_id })
      events.onToolExecutionStart?.(call.call_id, call.name)

      const result = await toolExecutor.execute(
        {
          name: call.name,
          call_id: call.call_id,
          arguments: call.arguments,
        },
        { sessionID },
      )

      // Check if interrupted
      try {
        const parsed = JSON.parse(result.output)
        if (parsed.interrupted) {
          log.info("tool was interrupted", { sessionID, name: call.name, call_id: call.call_id })
          events.onToolInterrupted?.(call.call_id, call.name)
          return
        }
      } catch {
        // Not JSON or no interrupted flag - continue
      }

      events.onToolExecutionComplete?.(call.call_id, call.name, result.output)

      // Submit result back to OpenAI
      if (state === "connected") {
        session.submitFunctionResult(result)
      }
    }

    // Forward server events to client
    const handleServerEvent = (event: RealtimeProtocol.ServerEvent) => {
      // Forward to client
      const json = JSON.stringify(event)
      events.onClientMessage?.(json)

      // Handle function calls specially
      if (event.type === "response.function_call_arguments.done") {
        events.onFunctionCall?.(event)
        // Auto-execute if enabled
        executeToolCall(event)
      }

      // Handle VAD speech detection - interrupt pending tools
      if (event.type === "input_audio_buffer.speech_started") {
        log.info("VAD speech detected, cancelling pending tools", { sessionID })
        toolExecutor?.cancelAll()
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
          // Cancel any pending tools on disconnect
          toolExecutor?.cancelAll()
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

          // Configure session with tools and settings
          if (options.tools || options.sessionConfig) {
            const sessionUpdate: RealtimeProtocol.SessionUpdate = {
              type: "session.update",
              session: {
                ...options.sessionConfig,
                // Add tools in OpenAI format
                ...(options.tools && {
                  tools: RealtimeTools.toolsToOpenAIFormat(options.tools),
                }),
              },
            }
            log.info("configuring session", { sessionID, toolCount: options.tools?.length ?? 0 })
            transport.send(sessionUpdate)
          }
        } catch (error) {
          log.error("failed to connect", { sessionID, error })
          setState("error")
          throw error
        }
      },

      stop() {
        log.info("stopping realtime session", { sessionID })
        toolExecutor?.cancelAll()
        transport.disconnect()
        setState("disconnected")
        registry.delete(sessionID)
      },

      cancelPendingTools() {
        log.info("manually cancelling pending tools", { sessionID })
        toolExecutor?.cancelAll()
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
