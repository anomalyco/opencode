/**
 * CollabProvider — manages the active Collab Session state and the SSE event stream.
 */

import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from "solid-js"
import type { CollabSession, CollabEvent, PromptSuggestion, Participant } from "@opencode-ai/collab"

interface CollabContextValue {
  session: () => CollabSession | null
  participants: () => Participant[]
  queue: () => PromptSuggestion[]
  isConnected: () => boolean

  // Actions
  submitPrompt: (content: string) => Promise<void>
  suggestPrompt: (content: string) => Promise<void>
  approvesuggestion: (suggestionId: string) => Promise<void>
  rejectSuggestion: (suggestionId: string) => Promise<void>
  castVote: (suggestionId: string) => Promise<void>
  resolvePool: () => Promise<void>
  changeRole: (githubId: number, role: string) => Promise<void>
  createInvite: (role: string) => Promise<{ url: string; token: string }>
  deleteSession: () => Promise<void>
}

const CollabContext = createContext<CollabContextValue>()

export function useCollab() {
  const ctx = useContext(CollabContext)
  if (!ctx) throw new Error("useCollab must be used within CollabProvider")
  return ctx
}

interface CollabProviderProps extends ParentProps {
  collabSessionId: string
}

export function CollabProvider(props: CollabProviderProps) {
  const [session, setSession] = createSignal<CollabSession | null>(null)
  const [queue, setQueue] = createSignal<PromptSuggestion[]>([])
  const [isConnected, setIsConnected] = createSignal(false)

  async function fetchSession() {
    try {
      const res = await fetch(`/collab/session/${props.collabSessionId}`)
      if (res.ok) setSession(await res.json())
    } catch {}
  }

  // Open SSE stream
  createEffect(() => {
    const es = new EventSource(`/collab/session/${props.collabSessionId}/events`)

    es.onopen = () => {
      setIsConnected(true)
      fetchSession()
    }

    es.onerror = () => {
      setIsConnected(false)
    }

    es.onmessage = (e) => {
      try {
        const event: CollabEvent = JSON.parse(e.data)
        handleEvent(event)
      } catch {}
    }

    onCleanup(() => es.close())
  })

  onMount(async () => {
    const res = await fetch(`/collab/session/${props.collabSessionId}/queue`)
    if (res.ok) {
      const data = await res.json()
      setQueue(data)
    }
  })

  function handleEvent(event: CollabEvent) {
    switch (event.type) {
      case "collab:participant_joined":
        setSession((prev) => {
          if (!prev) return prev
          const exists = prev.participants.find((p) => p.githubId === event.participant.githubId)
          return {
            ...prev,
            participants: exists
              ? prev.participants.map((p) =>
                  p.githubId === event.participant.githubId ? event.participant : p,
                )
              : [...prev.participants, event.participant],
          }
        })
        break

      case "collab:participant_left":
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            participants: prev.participants.map((p) =>
              p.githubLogin === event.githubLogin ? { ...p, isOnline: false } : p,
            ),
          }
        })
        break

      case "collab:role_changed":
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            participants: prev.participants.map((p) =>
              p.githubLogin === event.githubLogin ? { ...p, role: event.role } : p,
            ),
          }
        })
        break

      case "collab:queue_update":
        setQueue(event.queue)
        break

      case "collab:vote_cast":
        setQueue((prev) =>
          prev.map((s) =>
            s.id === event.suggestionId
              ? { ...s, voteScore: event.newScore, votes: [...s.votes, event.voterLogin] }
              : s,
          ),
        )
        break

      case "collab:session_deleted":
        setSession(null)
        break

      case "collab:native_session_linked":
        setSession((prev) => (prev ? { ...prev, sessionId: event.sessionId } : prev))
        break
    }
  }

  const api = (path: string, method: string, body?: unknown) =>
    fetch(`/collab/session/${props.collabSessionId}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })

  const value: CollabContextValue = {
    session,
    participants: () => session()?.participants ?? [],
    queue,
    isConnected,

    async submitPrompt(content) {
      await api("/prompt", "POST", { content })
    },
    async suggestPrompt(content) {
      await api("/suggest", "POST", { content })
    },
    async approvesuggestion(suggestionId) {
      await api(`/approve/${suggestionId}`, "POST")
    },
    async rejectSuggestion(suggestionId) {
      await api(`/reject/${suggestionId}`, "POST")
    },
    async castVote(suggestionId) {
      await api(`/vote/${suggestionId}`, "POST")
    },
    async resolvePool() {
      await api("/resolve", "POST")
    },
    async changeRole(githubId, role) {
      await api(`/participant/${githubId}/role`, "PUT", { role })
    },
    async createInvite(role) {
      const res = await api("/invite", "POST", { role })
      return res.json()
    },
    async deleteSession() {
      await api("", "DELETE")
    },
  }

  return <CollabContext.Provider value={value}>{props.children}</CollabContext.Provider>
}
