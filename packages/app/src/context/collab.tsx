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
  /** Local workspace directory on the server — available after first prompt is approved */
  nativeSessionDirectory: () => string | null
  /** GitHub logins of participants currently typing in their prompt editor. */
  typingUsers: () => Set<string>

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
  /** Broadcast that the local user has started/stopped typing.  Debounced by caller. */
  setTyping: (typing: boolean) => Promise<void>
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
  const [nativeSessionDirectory, setNativeSessionDirectory] = createSignal<string | null>(null)
  const [typingUsers, setTypingUsers] = createSignal<Set<string>>(new Set())

  function markTyping(githubLogin: string, typing: boolean) {
    setTypingUsers((prev) => {
      const next = new Set(prev)
      if (typing) next.add(githubLogin)
      else next.delete(githubLogin)
      return next
    })
  }

  async function fetchSession() {
    try {
      const res = await fetch(`/collab/session/${props.collabSessionId}`)
      if (res.ok) {
        const data = await res.json()
        const { workspacePath, ...sessionData } = data as CollabSession & { workspacePath?: string }
        setSession(sessionData)
        // Always set the workspace directory as soon as we know it, even if
        // no native opencode session exists yet — the iframe on the right
        // uses this to render the editor immediately so the user can type
        // and submit their first prompt without waiting for pre-warm.
        if (workspacePath) {
          setNativeSessionDirectory(workspacePath)
        }
      }
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
        // Offline implies "no longer typing".
        markTyping(event.githubLogin, false)
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
        setNativeSessionDirectory(event.directory)
        break

      case "collab:typing_start":
        markTyping(event.githubLogin, true)
        break

      case "collab:typing_stop":
        markTyping(event.githubLogin, false)
        break
    }
  }

  async function api(path: string, method: string, body?: unknown): Promise<Response> {
    const res = await fetch(`/collab/session/${props.collabSessionId}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      console.error(`[collab] API ${method} ${path} failed:`, res.status, text)
      throw new Error(text)
    }
    return res
  }

  const value: CollabContextValue = {
    session,
    participants: () => session()?.participants ?? [],
    queue,
    isConnected,
    nativeSessionDirectory,
    typingUsers,

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
    async setTyping(typing) {
      // Fire-and-forget: typing is a UX nicety, not worth retrying.
      // No-op silently on 200/4xx/5xx.
      try {
        await fetch(`/collab/session/${props.collabSessionId}/typing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ typing }),
        })
      } catch {
        // ignore
      }
    },
  }

  return <CollabContext.Provider value={value}>{props.children}</CollabContext.Provider>
}
