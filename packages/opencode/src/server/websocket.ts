import { Log } from "../util/log"
import { Bus } from "../bus"
import { SessionPrompt } from "../session/prompt"
import { Session } from "../session"
import z from "zod"
import type { ServerWebSocket } from "bun"

export namespace WebSocketServer {
  const log = Log.create({ service: "websocket" })

  /**
   * WebSocket connection data
   */
  export interface WebSocketData {
    sessionID?: string
    clientID: string
    subscribed: boolean
  }

  /**
   * Active WebSocket clients mapped by client ID
   */
  const clients = new Map<string, ServerWebSocket<WebSocketData>>()

  /**
   * Map of session IDs to client IDs for efficient session-based broadcasting
   */
  const sessionClients = new Map<string, Set<string>>()

  /**
   * Message types that can be sent from client to server
   */
  export const ClientMessage = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("subscribe"),
      sessionID: z.string(),
    }),
    z.object({
      type: z.literal("prompt"),
      sessionID: z.string(),
      content: z.string(),
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      agent: z.string().optional(),
    }),
    z.object({
      type: z.literal("ping"),
    }),
  ])

  export type ClientMessage = z.infer<typeof ClientMessage>

  /**
   * Server message types sent to clients
   */
  export interface ServerMessage {
    type: "event" | "error" | "pong" | "subscribed"
    data?: any
    error?: string
  }

  /**
   * WebSocket handlers for Bun server
   */
  export const handlers = {
    /**
     * Called when a new WebSocket connection is established
     */
    open(ws: ServerWebSocket<WebSocketData>) {
      const clientID = ws.data.clientID
      clients.set(clientID, ws)

      log.info("client connected", { clientID })

      // Send welcome message
      send(ws, {
        type: "event",
        data: {
          type: "server.connected",
          properties: {
            clientID,
          },
        },
      })
    },

    /**
     * Called when a message is received from a client
     */
    async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
      try {
        const messageStr = typeof message === "string" ? message : message.toString()
        const data = JSON.parse(messageStr)

        log.info("received message", {
          clientID: ws.data.clientID,
          type: data.type,
        })

        // Validate message
        const parsed = ClientMessage.parse(data)

        switch (parsed.type) {
          case "subscribe": {
            await handleSubscribe(ws, parsed.sessionID)
            break
          }

          case "prompt": {
            await handlePrompt(ws, parsed)
            break
          }

          case "ping": {
            send(ws, { type: "pong" })
            break
          }

          default:
            send(ws, {
              type: "error",
              error: `Unknown message type: ${(data as any).type}`,
            })
        }
      } catch (error) {
        log.error("error handling message", { error })
        send(ws, {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    /**
     * Called when a WebSocket connection is closed
     */
    close(ws: ServerWebSocket<WebSocketData>) {
      const clientID = ws.data.clientID
      const sessionID = ws.data.sessionID

      log.info("client disconnected", { clientID, sessionID })

      // Remove from clients map
      clients.delete(clientID)

      // Remove from session clients map
      if (sessionID) {
        const sessionClientSet = sessionClients.get(sessionID)
        if (sessionClientSet) {
          sessionClientSet.delete(clientID)
          if (sessionClientSet.size === 0) {
            sessionClients.delete(sessionID)
          }
        }
      }
    },

    /**
     * Called when an error occurs on the WebSocket
     */
    error(ws: ServerWebSocket<WebSocketData>, error: Error) {
      log.error("websocket error", {
        clientID: ws.data.clientID,
        error,
      })
    },
  }

  /**
   * Handle client subscription to a session
   */
  async function handleSubscribe(ws: ServerWebSocket<WebSocketData>, sessionID: string) {
    try {
      // Verify session exists
      await Session.get(sessionID)

      // Update WebSocket data
      ws.data.sessionID = sessionID

      // Add to session clients map
      if (!sessionClients.has(sessionID)) {
        sessionClients.set(sessionID, new Set())
      }
      sessionClients.get(sessionID)!.add(ws.data.clientID)

      // Subscribe to Bus events if not already subscribed
      if (!ws.data.subscribed) {
        ws.data.subscribed = true
        subscribeToEvents(ws)
      }

      log.info("client subscribed to session", {
        clientID: ws.data.clientID,
        sessionID,
      })

      send(ws, {
        type: "subscribed",
        data: { sessionID },
      })

      // Send current session state
      const session = await Session.get(sessionID)
      const messages = await Session.messages(sessionID)

      send(ws, {
        type: "event",
        data: {
          type: "session.state",
          properties: {
            session,
            messages,
          },
        },
      })
    } catch (error) {
      log.error("error subscribing to session", { error })
      send(ws, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Handle prompt message from client
   */
  async function handlePrompt(
    ws: ServerWebSocket<WebSocketData>,
    data: Extract<ClientMessage, { type: "prompt" }>,
  ) {
    try {
      log.info("handling prompt", {
        sessionID: data.sessionID,
        contentLength: data.content.length,
      })

      // Send prompt to session
      const result = await SessionPrompt.prompt({
        sessionID: data.sessionID,
        content: data.content,
        model: data.model,
        agent: data.agent,
      })

      // Result will be sent via Bus events
      log.info("prompt completed", {
        sessionID: data.sessionID,
        messageID: result.info.id,
      })
    } catch (error) {
      log.error("error handling prompt", { error })
      send(ws, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Subscribe a WebSocket client to Bus events
   */
  function subscribeToEvents(ws: ServerWebSocket<WebSocketData>) {
    Bus.subscribeAll((event) => {
      // Only send events relevant to this client's session
      const sessionID = ws.data.sessionID

      // If client is not subscribed to a session, don't send session-specific events
      if (!sessionID) {
        // Only send global events
        if (event.type.startsWith("server.")) {
          send(ws, {
            type: "event",
            data: event,
          })
        }
        return
      }

      // Send all events for the subscribed session
      if (
        event.properties?.sessionID === sessionID ||
        event.type.startsWith("server.") ||
        event.type.startsWith("config.")
      ) {
        send(ws, {
          type: "event",
          data: event,
        })
      }
    })
  }

  /**
   * Send a message to a WebSocket client
   */
  function send(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      log.error("error sending message", {
        clientID: ws.data.clientID,
        error,
      })
    }
  }

  /**
   * Broadcast a message to all clients subscribed to a session
   */
  export function broadcast(sessionID: string, message: ServerMessage) {
    const clientIDs = sessionClients.get(sessionID)
    if (!clientIDs) return

    for (const clientID of clientIDs) {
      const ws = clients.get(clientID)
      if (ws) {
        send(ws, message)
      }
    }
  }

  /**
   * Get count of active connections
   */
  export function getConnectionCount(): number {
    return clients.size
  }

  /**
   * Get count of connections for a specific session
   */
  export function getSessionConnectionCount(sessionID: string): number {
    return sessionClients.get(sessionID)?.size ?? 0
  }
}
