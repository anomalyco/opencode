import { createSignal, createEffect, onCleanup } from "solid-js"
import { client } from "../api/client"
import type { Session, Message, BusEvent } from "../types"

/**
 * Global session store
 * Manages sessions, messages, and WebSocket connection state
 */

// WebSocket connection state
export const [isConnected, setIsConnected] = createSignal(false)
export const [isConnecting, setIsConnecting] = createSignal(false)

// Sessions
export const [sessions, setSessions] = createSignal<Session[]>([])
export const [currentSessionID, setCurrentSessionID] = createSignal<string | null>(null)

// Messages for current session
export const [messages, setMessages] = createSignal<Message[]>([])

// Loading states
export const [isLoadingSessions, setIsLoadingSessions] = createSignal(false)
export const [isLoadingMessages, setIsLoadingMessages] = createSignal(false)
export const [isSendingMessage, setIsSendingMessage] = createSignal(false)

// Events log (for debugging)
export const [events, setEvents] = createSignal<BusEvent[]>([])

/**
 * Initialize WebSocket connection
 */
export async function connectWebSocket() {
  if (isConnected() || isConnecting()) return

  setIsConnecting(true)

  try {
    await client.connectWebSocket(
      () => {
        setIsConnected(true)
        setIsConnecting(false)
      },
      (error) => {
        console.error("WebSocket connection error:", error)
        setIsConnected(false)
        setIsConnecting(false)
      },
    )

    // Subscribe to all events
    client.onAny((event) => {
      handleEvent(event)
    })
  } catch (error) {
    console.error("Failed to connect WebSocket:", error)
    setIsConnected(false)
    setIsConnecting(false)
  }
}

/**
 * Disconnect WebSocket
 */
export function disconnectWebSocket() {
  client.disconnectWebSocket()
  setIsConnected(false)
}

/**
 * Load all sessions
 */
export async function loadSessions() {
  setIsLoadingSessions(true)
  try {
    const data = await client.getSessions()
    setSessions(data)
  } catch (error) {
    console.error("Failed to load sessions:", error)
  } finally {
    setIsLoadingSessions(false)
  }
}

/**
 * Create a new session
 */
export async function createSession(opts: {
  title?: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
} = {}) {
  try {
    const session = await client.createSession(opts)
    setSessions((prev) => [session, ...prev])
    return session
  } catch (error) {
    console.error("Failed to create session:", error)
    throw error
  }
}

/**
 * Delete a session
 */
export async function deleteSession(sessionID: string) {
  try {
    await client.deleteSession(sessionID)
    setSessions((prev) => prev.filter((s) => s.id !== sessionID))

    // If deleted session was current, clear current session
    if (currentSessionID() === sessionID) {
      setCurrentSessionID(null)
      setMessages([])
    }
  } catch (error) {
    console.error("Failed to delete session:", error)
    throw error
  }
}

/**
 * Select a session and load its messages
 */
export async function selectSession(sessionID: string) {
  setCurrentSessionID(sessionID)
  await loadMessages(sessionID)

  // Subscribe to session via WebSocket if connected
  if (isConnected()) {
    client.subscribeToSession(sessionID)
  }
}

/**
 * Load messages for a session
 */
export async function loadMessages(sessionID: string) {
  setIsLoadingMessages(true)
  try {
    const data = await client.getMessages(sessionID)
    setMessages(data)
  } catch (error) {
    console.error("Failed to load messages:", error)
  } finally {
    setIsLoadingMessages(false)
  }
}

/**
 * Send a message to the current session
 */
export async function sendMessage(
  content: string,
  opts: {
    model?: {
      providerID: string
      modelID: string
    }
    agent?: string
  } = {},
) {
  const sessionID = currentSessionID()
  if (!sessionID) {
    throw new Error("No session selected")
  }

  setIsSendingMessage(true)

  try {
    if (isConnected()) {
      // Send via WebSocket for real-time streaming
      client.sendPromptViaWebSocket(sessionID, content, opts)
      // Response will come via WebSocket events
    } else {
      // Fallback to REST API
      await client.sendPrompt(sessionID, content, opts)
      // Reload messages
      await loadMessages(sessionID)
    }
  } catch (error) {
    console.error("Failed to send message:", error)
    throw error
  } finally {
    setIsSendingMessage(false)
  }
}

/**
 * Handle WebSocket events
 */
function handleEvent(event: BusEvent) {
  // Add to events log
  setEvents((prev) => [...prev.slice(-99), event])

  switch (event.type) {
    case "session.created":
      // Add new session to list
      if (event.properties.session) {
        setSessions((prev) => [event.properties.session, ...prev])
      }
      break

    case "session.updated":
      // Update session in list
      if (event.properties.session) {
        setSessions((prev) =>
          prev.map((s) => (s.id === event.properties.session.id ? event.properties.session : s)),
        )
      }
      break

    case "session.deleted":
      // Remove session from list
      if (event.properties.sessionID) {
        setSessions((prev) => prev.filter((s) => s.id !== event.properties.sessionID))
      }
      break

    case "session.message.created":
      // Add new message if it's for current session
      if (event.properties.sessionID === currentSessionID() && event.properties.message) {
        setMessages((prev) => {
          // Check if message already exists
          const exists = prev.some((m) => m.id === event.properties.message.id)
          if (exists) return prev
          return [...prev, event.properties.message]
        })
        setIsSendingMessage(false)
      }
      break

    case "session.message.updated":
      // Update message if it's for current session
      if (event.properties.sessionID === currentSessionID() && event.properties.message) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.properties.message.id ? event.properties.message : m,
          ),
        )
      }
      break

    case "session.message.part.created":
      // Update message parts in real-time
      if (event.properties.sessionID === currentSessionID()) {
        const messageID = event.properties.messageID
        const part = event.properties.part

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageID) {
              // Check if part already exists
              const existingPartIndex = m.parts.findIndex((p) => p.id === part.id)
              if (existingPartIndex >= 0) {
                // Update existing part
                const newParts = [...m.parts]
                newParts[existingPartIndex] = part
                return { ...m, parts: newParts }
              } else {
                // Add new part
                return { ...m, parts: [...m.parts, part] }
              }
            }
            return m
          }),
        )
      }
      break

    case "client.error":
      console.error("Client error:", event.properties.error)
      break

    default:
      // Log other events for debugging
      console.log("Event:", event.type, event.properties)
  }
}

/**
 * Initialize the store
 */
export function initializeStore() {
  // Load sessions on mount
  loadSessions()

  // Auto-connect WebSocket
  connectWebSocket()

  // Re-subscribe to current session when WebSocket reconnects
  createEffect(() => {
    if (isConnected() && currentSessionID()) {
      client.subscribeToSession(currentSessionID()!)
    }
  })
}
