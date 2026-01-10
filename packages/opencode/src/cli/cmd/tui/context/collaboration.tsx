import { createStore } from "solid-js/store"
import { createEffect, onCleanup, createMemo } from "solid-js"
import { useSDK } from "./sdk"
import { useSync, type CollaborationTypes } from "./sync"
import { createSimpleContext } from "./helper"

export const { use: useCollaboration, provider: CollaborationProvider } = createSimpleContext({
  name: "Collaboration",
  init: () => {
    const sdk = useSDK()
    const sync = useSync()

    const [store, setStore] = createStore<{
      sessionID: string | null
      participantID: string | null
      participantName: string | null
    }>({
      sessionID: null,
      participantID: null,
      participantName: null,
    })

    // Helper for API calls
    async function api<T>(
      path: string,
      options?: { method?: string; body?: unknown },
    ): Promise<T | null> {
      try {
        const res = await fetch(`${sdk.url}${path}`, {
          method: options?.method ?? "GET",
          headers: options?.body ? { "Content-Type": "application/json" } : undefined,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        })
        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(error.error || res.statusText)
        }
        return res.json()
      } catch (e) {
        console.error(`Collaboration API error: ${path}`, e)
        throw e
      }
    }

    // Heartbeat interval when joined
    let heartbeatInterval: Timer | null = null

    createEffect(() => {
      if (store.sessionID && store.participantID) {
        // Send heartbeat every 10 seconds
        heartbeatInterval = setInterval(() => {
          api(`/session/${store.sessionID}/collaboration/heartbeat`, {
            method: "POST",
            body: { participantID: store.participantID },
          }).catch(() => {
            // Silently ignore heartbeat failures
          })
        }, 10_000)
      } else if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
    })

    onCleanup(() => {
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      // Leave session on cleanup
      if (store.sessionID && store.participantID) {
        api(`/session/${store.sessionID}/collaboration/leave`, {
          method: "POST",
          body: { participantID: store.participantID },
        }).catch(() => {
          // Best effort cleanup
        })
      }
    })

    return {
      // Getters for current user's state
      get isJoined() {
        return store.sessionID !== null && store.participantID !== null
      },
      get sessionID() {
        return store.sessionID
      },
      get participantID() {
        return store.participantID
      },
      get participantName() {
        return store.participantName
      },

      // Get collaboration state for a session from sync store
      state(sessionID: string) {
        return sync.data.collaboration[sessionID]
      },

      // Check if a session has participants
      isCollaborative(sessionID: string) {
        const state = sync.data.collaboration[sessionID]
        return state !== undefined && Object.keys(state.participants).length > 0
      },

      // Get participants for a session
      participants(sessionID: string): CollaborationTypes.Participant[] {
        const state = sync.data.collaboration[sessionID]
        return state ? Object.values(state.participants) : []
      },

      // Get typing users for a session (excluding self)
      typingUsers(sessionID: string): CollaborationTypes.Participant[] {
        const state = sync.data.collaboration[sessionID]
        if (!state) return []
        return Object.values(state.typingStatuses)
          .filter((s) => s.participantID !== store.participantID)
          .map((s) => state.participants[s.participantID])
          .filter((p): p is CollaborationTypes.Participant => p !== undefined)
      },

      // Get the driver for a session
      driver(sessionID: string): CollaborationTypes.Participant | null {
        const state = sync.data.collaboration[sessionID]
        if (!state) return null
        return Object.values(state.participants).find((p) => p.role === "driver") ?? null
      },

      // Check if current user is the driver
      isDriver(sessionID: string): boolean {
        const state = sync.data.collaboration[sessionID]
        if (!state || !store.participantID) return false
        return state.participants[store.participantID]?.role === "driver"
      },

      // Join a collaborative session
      async join(sessionID: string, name: string): Promise<CollaborationTypes.Participant> {
        console.log("[COLLAB] Joining session", sessionID, "as", name)
        const participant = await api<CollaborationTypes.Participant>(
          `/session/${sessionID}/collaboration/join`,
          {
            method: "POST",
            body: { name },
          },
        )
        console.log("[COLLAB] Join response:", participant)

        if (!participant) {
          throw new Error("Failed to join collaboration")
        }

        setStore({
          sessionID,
          participantID: participant.id,
          participantName: name,
        })

        // Ensure collaboration state exists in sync store before setting myParticipantID
        if (!sync.data.collaboration[sessionID]) {
          sync.set("collaboration", sessionID, {
            participants: {},
            typingStatuses: {},
            messageQueue: [],
            pendingWaits: [],
            waitingFor: [],
            joinCode: null,
            myParticipantID: participant.id,
          })
        } else {
          sync.set("collaboration", sessionID, "myParticipantID", participant.id)
        }

        // Also add ourselves to participants immediately (SSE event will also do this)
        sync.set("collaboration", sessionID, "participants", participant.id, participant)

        return participant
      },

      // Leave current session
      async leave(): Promise<void> {
        if (!store.sessionID || !store.participantID) return

        await api(`/session/${store.sessionID}/collaboration/leave`, {
          method: "POST",
          body: { participantID: store.participantID },
        })

        setStore({
          sessionID: null,
          participantID: null,
          participantName: null,
        })
      },

      // Update typing status
      setTyping(isTyping: boolean): void {
        if (!store.sessionID || !store.participantID) return

        api(`/session/${store.sessionID}/collaboration/typing`, {
          method: "POST",
          body: {
            participantID: store.participantID,
            isTyping,
          },
        }).catch(() => {
          // Silently ignore typing status failures
        })
      },

      // Queue a message (non-driver)
      async queueMessage(
        text: string,
        attachments?: unknown[],
      ): Promise<CollaborationTypes.QueuedMessage | null> {
        console.log("[COLLAB] Queueing message:", text.slice(0, 50))
        if (!store.sessionID || !store.participantID || !store.participantName) {
          console.log("[COLLAB] Cannot queue - not joined:", { sessionID: store.sessionID, participantID: store.participantID })
          return null
        }

        const result = await api<CollaborationTypes.QueuedMessage>(
          `/session/${store.sessionID}/collaboration/message`,
          {
            method: "POST",
            body: {
              participantID: store.participantID,
              participantName: store.participantName,
              text,
              attachments,
            },
          },
        )
        console.log("[COLLAB] Queue response:", result)
        return result
      },

      // Force flush the queue (driver only)
      async forceFlush(): Promise<{
        flushed: boolean
        combinedMessage?: string
        participants?: string[]
      } | null> {
        if (!store.sessionID || !store.participantID) return null

        const result = await api<{ flushed: boolean; combinedMessage?: string; participants?: string[] }>(
          `/session/${store.sessionID}/collaboration/flush`,
          {
            method: "POST",
            body: { participantID: store.participantID },
          },
        )
        if (result?.flushed) {
          // Clear local queue immediately (SSE may arrive later / be dropped)
          sync.set("collaboration", store.sessionID, "messageQueue", [])
          sync.set("collaboration", store.sessionID, "pendingWaits", [])
          sync.set("collaboration", store.sessionID, "waitingFor", [])
        }
        return result
      },

      // Create a join code
      async createJoinCode(): Promise<{
        code: string
        link: string
        formatted: string
      } | null> {
        if (!store.sessionID || !store.participantID) return null

        return api<{ code: string; link: string; formatted: string }>(
          `/session/${store.sessionID}/collaboration/code`,
          {
            method: "POST",
            body: { participantID: store.participantID },
          },
        )
      },

      // Get join code for a session
      async getJoinCode(
        sessionID: string,
      ): Promise<{ code: string; link: string; formatted: string } | null> {
        return api<{ code: string; link: string; formatted: string } | null>(
          `/session/${sessionID}/collaboration/code`,
        )
      },

      // Validate a join code
      async validateJoinCode(
        code: string,
      ): Promise<{ valid: boolean; sessionID?: string; error?: string }> {
        const cleanCode = code.replace(/[-\s]/g, "").toUpperCase()
        const result = await api<{ valid: boolean; sessionID?: string; error?: string }>(
          `/collaboration/join/${cleanCode}`,
        )
        return result ?? { valid: false, error: "Failed to validate code" }
      },

      // Fetch collaboration state for a session
      async fetchState(sessionID: string): Promise<void> {
        const state = await api<{
          sessionID: string
          participants: Record<string, CollaborationTypes.Participant>
          typingStatuses: Record<string, CollaborationTypes.TypingStatus>
          messageQueue: CollaborationTypes.QueuedMessage[]
          pendingWaits: CollaborationTypes.PendingWait[]
        }>(`/session/${sessionID}/collaboration`)

        if (state && Object.keys(state.participants).length > 0) {
          sync.set("collaboration", sessionID, {
            participants: state.participants,
            typingStatuses: state.typingStatuses,
            messageQueue: state.messageQueue,
            pendingWaits: state.pendingWaits,
            waitingFor: [],
            joinCode: null,
            myParticipantID: store.sessionID === sessionID ? store.participantID : null,
          })
        }
      },
    }
  },
})
