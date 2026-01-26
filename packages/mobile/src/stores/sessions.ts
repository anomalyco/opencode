import { create } from "zustand"
import type { Session, Message, Part, Event, MessageWithParts, Client } from "../lib/sdk"
import { useConnections } from "./connections"
import { useSettings } from "./settings"

// Helper to convert API response to our internal format
function parseMessages(response: MessageWithParts[]): { messages: Message[]; parts: Record<string, Part[]> } {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}

  for (const item of response || []) {
    messages.push(item.info)
    parts[item.info.id] = item.parts || []
  }

  return { messages, parts }
}

function pageSize(): number {
  return useSettings.getState().pageSize
}

interface SessionsState {
  sessions: Session[]
  currentSession: Session | null
  messages: Message[]
  parts: Record<string, Part[]>
  isLoading: boolean
  // Per-session optimistic sending flag — bridging gap between user tap and SSE busy
  sending: Record<string, boolean>
  loadingMore: boolean
  hasMore: boolean
  error: string | null

  // Actions
  loadSessions: () => Promise<void>
  selectSession: (sessionID: string, directory?: string) => Promise<void>
  loadOlderMessages: () => Promise<void>
  createSession: (title?: string) => Promise<Session | null>
  deleteSession: (sessionID: string) => Promise<void>
  sendMessage: (
    text: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    files?: Array<{ uri: string; mime: string; filename?: string; base64?: string }>,
  ) => Promise<void>
  abortSession: () => Promise<void>
  refreshMessages: () => Promise<void>

  // Event handling
  handleEvent: (event: Event) => void
}

// Get the right client for a session's directory
function clientFor(directory?: string): Client | null {
  const connState = useConnections.getState()
  if (!directory) return connState.client
  const connDir = connState.activeConnection?.directory
  if (directory !== connDir) return connState.clientForDirectory(directory)
  return connState.client
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  currentSession: null,
  messages: [],
  parts: {},
  isLoading: false,
  sending: {},
  loadingMore: false,
  hasMore: false,
  error: null,

  loadSessions: async () => {
    const client = useConnections.getState().client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      set({ isLoading: true, error: null })
      const sessions = await client.session.list({ roots: true, limit: 50 })
      set({ sessions, isLoading: false })
    } catch (error) {
      set({ error: "Failed to load sessions", isLoading: false })
    }
  },

  selectSession: async (sessionID, directory) => {
    // Use directory-specific client if the session belongs to a different project
    const connState = useConnections.getState()
    const client = directory ? connState.clientForDirectory(directory) : connState.client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      // Reset optimistic sending — SSE sessionStatus is the source of truth
      set((state) => ({
        isLoading: true,
        error: null,
        hasMore: false,
        loadingMore: false,
        sending: { ...state.sending, [sessionID]: false },
      }))

      const [session, messagesResponse] = await Promise.all([
        client.session.get(sessionID),
        client.session.messages(sessionID, { limit: pageSize() }),
      ])

      // Parse the API response format: array of { info, parts }
      const { messages, parts } = parseMessages(messagesResponse)

      set({
        currentSession: session,
        messages,
        parts,
        isLoading: false,
        // If we got exactly PAGE_SIZE messages, there are probably more
        hasMore: messagesResponse.length >= pageSize(),
      })
    } catch (err) {
      console.error("Failed to load session:", err)
      set({ error: "Failed to load session", isLoading: false })
    }
  },

  loadOlderMessages: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return
    if (get().loadingMore || !get().hasMore) return

    try {
      set({ loadingMore: true })

      // Fetch ALL messages for this session
      const response = await client.session.messages(session.id)
      const { messages: all, parts: allParts } = parseMessages(response)

      // Merge: use all messages from full fetch, but keep any temp/optimistic messages
      const existing = get().messages
      const temp = existing.filter((m) => m.id.startsWith("temp-"))
      const merged = [...all, ...temp]

      set({
        messages: merged,
        parts: { ...allParts, ...Object.fromEntries(temp.map((m) => [m.id, get().parts[m.id] || []])) },
        loadingMore: false,
        hasMore: false, // We loaded everything
      })
    } catch (error) {
      console.error("Failed to load older messages:", error)
      set({ loadingMore: false })
    }
  },

  createSession: async (title) => {
    const client = useConnections.getState().client
    if (!client) {
      set({ error: "No active connection" })
      return null
    }

    try {
      const session = await client.session.create({ title })
      // Don't optimistically add to sessions list — let loadSessions() handle it
      // to avoid duplicate key errors from race conditions
      set({
        currentSession: session,
        messages: [],
        parts: {},
        hasMore: false,
        loadingMore: false,
      })
      return session
    } catch (error) {
      set({ error: "Failed to create session" })
      return null
    }
  },

  deleteSession: async (sessionID) => {
    const client = useConnections.getState().client
    if (!client) {
      set({ error: "No active connection" })
      return
    }

    try {
      await client.session.delete(sessionID)
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionID),
        currentSession: state.currentSession?.id === sessionID ? null : state.currentSession,
        messages: state.currentSession?.id === sessionID ? [] : state.messages,
        parts: state.currentSession?.id === sessionID ? {} : state.parts,
      }))
    } catch (error) {
      set({ error: "Failed to delete session" })
    }
  },

  sendMessage: async (text, model, agent, files) => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) {
      set({ error: "No active session" })
      return
    }

    try {
      set((state) => ({ sending: { ...state.sending, [session.id]: true }, error: null }))

      // Add user message optimistically
      const ts = Date.now()
      const userMessage: Message = {
        id: `temp-${ts}`,
        sessionID: session.id,
        role: "user",
        time: { created: ts },
        model,
        agent,
      }
      const optimisticParts: Part[] = []
      if (text) {
        optimisticParts.push({
          id: `temp-part-text-${ts}`,
          messageID: userMessage.id,
          type: "text",
          text,
        })
      }
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          optimisticParts.push({
            id: `temp-part-file-${ts}-${i}`,
            messageID: userMessage.id,
            type: "file",
            mime: f.mime,
            url: f.uri,
            filename: f.filename,
          })
        }
      }

      set((state) => ({
        messages: [...state.messages, userMessage],
        parts: { ...state.parts, [userMessage.id]: optimisticParts },
      }))

      // Build prompt parts - images are already converted to JPEG with base64 by toJpeg()
      const promptParts: Array<
        { type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }
      > = []
      if (text) {
        promptParts.push({ type: "text", text })
      }
      if (files) {
        for (const f of files) {
          const url = f.base64 ? `data:${f.mime};base64,${f.base64}` : f.uri
          promptParts.push({ type: "file", mime: f.mime, url, filename: f.filename })
        }
      }

      // Fire and forget - SSE events will update messages/parts/status in real-time
      client.session.prompt(session.id, { parts: promptParts, model, agent }).catch((err) => {
        console.error("Failed to send message:", err)
        set((state) => ({ error: String(err), sending: { ...state.sending, [session.id]: false } }))
        get().refreshMessages()
      })
    } catch (err) {
      console.error("[sendMessage] error:", err)
      set((state) => ({ error: String(err), sending: { ...state.sending, [session.id]: false } }))
      get().refreshMessages()
    }
  },

  abortSession: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return

    try {
      await client.session.abort(session.id)
      set((state) => ({ sending: { ...state.sending, [session.id]: false } }))
    } catch {
      set({ error: "Failed to abort session" })
    }
  },

  refreshMessages: async () => {
    const client = clientFor(get().currentSession?.directory)
    const session = get().currentSession
    if (!client || !session) return

    try {
      const response = await client.session.messages(session.id)
      const { messages, parts } = parseMessages(response)
      set({ messages, parts })
    } catch (error) {
      set({ error: "Failed to refresh messages" })
    }
  },

  handleEvent: (event) => {
    const { currentSession } = get()
    if (!currentSession) return

    const props = (event as any).properties || {}

    switch (event.type) {
      case "message.updated": {
        const message = (props.info || props.message) as Message | undefined
        if (!message || message.sessionID !== currentSession.id) return

        set((state) => {
          // Remove temp messages when real ones arrive
          const filtered = state.messages.filter((m) => !m.id.startsWith("temp-") || m.id === message.id)
          const exists = filtered.some((m) => m.id === message.id)
          return {
            messages: exists ? filtered.map((m) => (m.id === message.id ? message : m)) : [...filtered, message],
          }
        })
        break
      }

      case "message.part.updated": {
        const part = props.part as Part | undefined
        if (!part) return
        // Only handle parts for current session
        if (part.sessionID && part.sessionID !== currentSession.id) return

        set((state) => {
          const messageParts = state.parts[part.messageID] || []
          const exists = messageParts.some((p) => p.id === part.id)
          return {
            parts: {
              ...state.parts,
              [part.messageID]: exists
                ? messageParts.map((p) => (p.id === part.id ? part : p))
                : [...messageParts, part],
            },
          }
        })
        break
      }

      case "message.removed": {
        const messageID = props.messageID as string
        if (!messageID) return
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== messageID),
          parts: Object.fromEntries(Object.entries(state.parts).filter(([k]) => k !== messageID)),
        }))
        break
      }

      case "session.updated": {
        const session = (props.info || props) as Session | undefined
        if (!session?.id) return

        set((state) => ({
          sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
          currentSession: state.currentSession?.id === session.id ? session : state.currentSession,
        }))
        break
      }
    }
  },
}))
