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
import type { CollabSession, CollabEvent, CollabRole, PromptSuggestion, Participant, CollabNote } from "@opencode-ai/collab"

interface CollabContextValue {
  session: () => CollabSession | null
  participants: () => Participant[]
  queue: () => PromptSuggestion[]
  isConnected: () => boolean
  /** Local workspace directory on the server — available after first prompt is approved */
  nativeSessionDirectory: () => string | null
  /** GitHub logins of participants currently typing in their prompt editor. */
  typingUsers: () => Set<string>
  /** TCP ports the workspace container is currently listening on (likely dev servers). */
  previewPorts: () => number[]
  /** Number of unread @-mentions for the current user (cleared by clearMentions). */
  unreadMentions: () => number
  /** Mark all currently-unread mentions as read (called when the user views the queue/etc.). */
  clearMentions: () => void
  /** Team-chat notes for this session, oldest-first (chronological). */
  notes: () => CollabNote[]
  /** Post a side-channel team note (does NOT go to the LLM). */
  postNote: (content: string) => Promise<void>

  // Actions
  submitPrompt: (content: string, model?: string, agent?: string, variant?: string) => Promise<void>
  suggestPrompt: (content: string, model?: string, agent?: string, variant?: string) => Promise<void>
  approvesuggestion: (suggestionId: string) => Promise<void>
  rejectSuggestion: (suggestionId: string) => Promise<void>
  castVote: (suggestionId: string) => Promise<void>
  /** Toggle an emoji reaction on a suggestion. */
  react: (suggestionId: string, emoji: string) => Promise<void>
  resolvePool: () => Promise<void>
  changeRole: (githubId: number, role: string) => Promise<void>
  createInvite: (role: string) => Promise<{ url: string; token: string }>
  /** Driver-only: git push + open a GitHub PR with collab session metadata in the body. */
  openPullRequest: () => Promise<{ url: string }>
  /** Viewer's role in this collab session.  Falls back to "viewer" until
   *  the session/participant data has loaded (safe default for gating UI). */
  viewerRole: () => CollabRole
  /** Driver-only: append repos to a session.  Used by the empty-session
   *  fallback UI in /collab/<id> when no repos were selected at create
   *  time.  Returns the actually-new repos (existing ones are skipped). */
  addRepos: (repos: string[]) => Promise<{ added: string[] }>
  deleteSession: () => Promise<void>
  /** Broadcast that the local user has started/stopped typing.  Debounced by caller. */
  setTyping: (typing: boolean) => Promise<void>
  /**
   * Driver-only: retry workspace initialization after it failed.  Wipes the
   * server-side workspace dir, resets initStatus → "pending", and re-runs
   * the clone + branch checkout.  See POST /collab/session/:id/reinit.
   */
  reinitWorkspace: () => Promise<void>

  // ── Preview launcher (frontend live preview) ─────────────────────────────
  /** Snapshot of the running frontend preview, if any.  Driven by SSE
   *  events `collab:preview_started/_log/_stopped/_failed` plus a one-off
   *  GET /collab/session/:id/preview/state on mount. */
  previewState: () => PreviewStateSnapshot | null
  /** Driver-only: spawn pnpm install + start in the workspace.
   *  Returns the state snapshot on 202, throws on 4xx/5xx. */
  launchPreview: () => Promise<void>
  /** Driver-only: SIGTERM the running dev server. */
  stopPreview: () => Promise<void>
  /** Driver-only: stop + relaunch with the same config. */
  restartPreview: () => Promise<void>
}

/** Mirrors PreviewStateSnapshot in collab/preview-launcher.ts. */
export interface PreviewStateSnapshot {
  collabSessionId: string
  repoFullName: string
  port: number
  label: string
  status: "installing" | "running" | "stopped" | "failed"
  startedAt: number
  lastTraffic: number
  recentLog: ReadonlyArray<{ stream: "stdout" | "stderr"; line: string; ts: number }>
  errorMessage?: string
}

const CollabContext = createContext<CollabContextValue>()

export function useCollab() {
  const ctx = useContext(CollabContext)
  if (!ctx) throw new Error("useCollab must be used within CollabProvider")
  return ctx
}

interface CollabProviderProps extends ParentProps {
  collabSessionId: string
  /**
   * Current user's GitHub numeric id.  Used to optimistically mark the
   * local participant as online the moment the SSE stream opens — the
   * server-driven update can lag behind a refresh / network blip, so the
   * green dot needs a client-side path to flip without waiting.
   */
  meGithubId?: number
}

export function CollabProvider(props: CollabProviderProps) {
  const [session, setSession] = createSignal<CollabSession | null>(null)
  const [queue, setQueue] = createSignal<PromptSuggestion[]>([])
  const [isConnected, setIsConnected] = createSignal(false)
  const [nativeSessionDirectory, setNativeSessionDirectory] = createSignal<string | null>(null)
  const [typingUsers, setTypingUsers] = createSignal<Set<string>>(new Set())
  const [previewPorts, setPreviewPorts] = createSignal<number[]>([])
  const [unreadMentions, setUnreadMentions] = createSignal<number>(0)
  const [notes, setNotes] = createSignal<CollabNote[]>([])
  // Frontend live-preview state — null when no preview is running.  Server
  // broadcasts a "started" event on SSE (re)connect when one IS running, so
  // the SPA picks up the state on full page reloads too.  Backed up by a
  // one-off GET /collab/session/:id/preview/state on mount in case the
  // SSE replay is missed.
  const [previewState, setPreviewState] = createSignal<PreviewStateSnapshot | null>(null)

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
      // Optimistically mark our own avatar as online — the server has
      // already called setOnline(true) by the time the SSE response
      // arrives, but fetchSession can race and a stale GET response
      // would otherwise keep our own dot dark for a beat.
      if (props.meGithubId != null) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                participants: prev.participants.map((p) =>
                  p.githubId === props.meGithubId ? { ...p, isOnline: true } : p,
                ),
              }
            : prev,
        )
      }
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

  // Hydrate the team-chat notes feed on first load.  Subsequent updates
  // come through the collab:note_added SSE event.
  onMount(async () => {
    try {
      const res = await fetch(`/collab/session/${props.collabSessionId}/notes`)
      if (!res.ok) return
      const data = (await res.json()) as { notes?: CollabNote[] }
      if (data.notes) setNotes(data.notes.map(deserializeNote))
    } catch {
      // ignore — notes feed is non-critical
    }
  })

  // Hydrate the preview state on first load.  The SSE replay on connect
  // emits collab:preview_started too (see router.ts handleSse), but doing
  // a one-off GET here means the launcher banner is correct from the very
  // first frame instead of flickering null → state when SSE catches up.
  onMount(async () => {
    try {
      const res = await fetch(`/collab/session/${props.collabSessionId}/preview/state`)
      if (!res.ok) return
      const data = (await res.json()) as PreviewStateSnapshot | null
      if (data && typeof data === "object" && "port" in data) {
        setPreviewState(data)
      }
    } catch {
      // ignore — banner just stays in launch-ready state until first SSE event
    }
  })

  /** SSE payloads put Dates through JSON; turn them back into Date objects. */
  function deserializeNote(n: CollabNote): CollabNote {
    return { ...n, createdAt: new Date(n.createdAt as unknown as string) }
  }

  // Periodically re-read the current branch of each repo so the left-panel
  // display tracks `git checkout` operations performed by the LLM (or by
  // a user via the iframe's terminal panel).  Lightweight — the endpoint
  // runs one `rev-parse --abbrev-ref HEAD` per repo, typically <30 ms total.
  // Pauses when the tab is hidden to avoid burning cycles on backgrounded
  // sessions.
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    async function pollOnce() {
      if (typeof document !== "undefined" && document.hidden) return
      try {
        const r = await fetch(`/collab/session/${props.collabSessionId}/branches`)
        if (!r.ok) return
        const data = (await r.json()) as { repoBranches?: Record<string, string> }
        if (!data.repoBranches) return
        setSession((prev) =>
          prev && !shallowBranchesEqual(prev.repoBranches, data.repoBranches)
            ? { ...prev, repoBranches: data.repoBranches }
            : prev,
        )
      } catch {
        // network blip — try again next interval
      }
    }
    function start() {
      if (timer) return
      pollOnce()
      timer = setInterval(pollOnce, 4000)
    }
    function stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    start()
    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.hidden) stop()
      else start()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }
    onCleanup(() => {
      stop()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
    })
  })

  // Poll the list of TCP ports the container is listening on every 5 s.
  // When the LLM (or a user via the iframe terminal) runs `npm run dev`
  // and Vite binds to :5173, this is what surfaces the chip in the UI.
  // Same visibility-aware pause as the branch poller.
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    async function pollOnce() {
      if (typeof document !== "undefined" && document.hidden) return
      try {
        const r = await fetch(`/collab/session/${props.collabSessionId}/preview-ports`)
        if (!r.ok) return
        const data = (await r.json()) as { ports?: number[] }
        const next = data.ports ?? []
        setPreviewPorts((prev) => {
          if (prev.length === next.length && prev.every((p, i) => p === next[i])) return prev
          return next
        })
      } catch {
        // ignore network blips
      }
    }
    function start() {
      if (timer) return
      pollOnce()
      timer = setInterval(pollOnce, 5000)
    }
    function stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    start()
    const onVisibility = () => {
      if (typeof document === "undefined") return
      if (document.hidden) stop()
      else start()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }
    onCleanup(() => {
      stop()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
    })
  })

  /** True iff both maps have the same keys and the same string values. */
  function shallowBranchesEqual(
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
  ): boolean {
    if (!a) return !b || Object.keys(b).length === 0
    if (!b) return Object.keys(a).length === 0
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (a[k] !== b[k]) return false
    return true
  }

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

      case "collab:workspace_ready":
        // Server finished cloning + checking out + pre-warming.  Flip the
        // session's initStatus so the iframe gate in pages/collab/session.tsx
        // can mount the iframe (it ANDs initStatus === "ready" with the
        // existing nativeSessionDirectory + sessionId gates).
        setSession((prev) =>
          prev ? { ...prev, initStatus: "ready", initError: null } : prev,
        )
        break

      case "collab:workspace_failed":
        // Server couldn't init the workspace.  Surface the reason so the
        // recovery panel can display it; a Driver can retry via
        // POST /collab/session/:id/reinit.
        setSession((prev) =>
          prev ? { ...prev, initStatus: "failed", initError: event.error } : prev,
        )
        break

      case "collab:typing_start":
        console.debug("[collab] typing_start", event.githubLogin)
        markTyping(event.githubLogin, true)
        break

      case "collab:typing_stop":
        console.debug("[collab] typing_stop", event.githubLogin)
        markTyping(event.githubLogin, false)
        break

      case "collab:reaction_changed":
        // Merge the new reaction map into whichever suggestion it belongs
        // to (could be in queue() or future approved/submitted lists).
        setQueue((prev) =>
          prev.map((s) =>
            s.id === event.suggestionId
              ? { ...s, reactions: Object.keys(event.reactions).length > 0 ? event.reactions : undefined }
              : s,
          ),
        )
        break

      case "collab:note_added":
        setNotes((prev) => [...prev, deserializeNote(event.note)])
        break

      case "collab:repos_added":
        // Repos can only be added by a Driver via PATCH /collab/session/:id.
        // Refetch the session so the SPA's iframe gate (and the iframe URL
        // itself, which encodes the workspace directory) re-evaluates
        // against the new repo list.
        fetchSession()
        break

      // ── Preview launcher events ────────────────────────────────────────
      case "collab:preview_started":
        // Carries the full state snapshot (status may be "installing" OR
        // "running" depending on whether the dev server has bound its port
        // yet — the launcher transitions via readyPattern / heuristic log
        // match).  Just write the snapshot through.
        setPreviewState(event.state)
        break

      case "collab:preview_stopped":
        setPreviewState(null)
        break

      case "collab:preview_failed":
        setPreviewState((prev) =>
          prev
            ? { ...prev, status: "failed", errorMessage: event.error }
            : prev,
        )
        break

      case "collab:preview_log":
        // Append a line and trim to the same cap the server retains (200).
        // We do the cap clientside too so a long-running preview can't grow
        // the SPA's heap unbounded.
        setPreviewState((prev) => {
          if (!prev) return prev
          const next = prev.recentLog.concat({
            stream: event.stream,
            line: event.line,
            ts: Date.now(),
          })
          const trimmed = next.length > 200 ? next.slice(next.length - 200) : next
          return { ...prev, recentLog: trimmed }
        })
        break

      case "collab:mention":
        // Only react if it's me being mentioned (every browser receives the
        // broadcast — we filter client-side so the SSE stream stays simple).
        if (props.meGithubId != null) {
          const me = session()?.participants.find((p) => p.githubId === props.meGithubId)
          if (me && me.githubLogin === event.mentionedLogin) {
            console.debug("[collab] @-mention received", event)
            setUnreadMentions((n) => n + 1)
            fireMentionNotification(event.authorLogin, event.context.excerpt)
          }
        }
        break
    }
  }

  /**
   * Show a browser desktop notification for an @-mention.  Lazily asks for
   * permission the first time we need to fire one — never up-front, so users
   * who don't care don't see a prompt.
   */
  function fireMentionNotification(authorLogin: string, excerpt: string) {
    if (typeof Notification === "undefined") return
    const showOne = () => {
      try {
        const n = new Notification(`@${authorLogin} mentioned you`, {
          body: excerpt,
          icon: `https://github.com/${authorLogin}.png?size=96`,
          tag: `collab-mention-${props.collabSessionId}`,
        })
        // Clicking the notification surfaces the tab.
        n.onclick = () => {
          window.focus()
          n.close()
        }
      } catch {
        // Some browsers throw on cross-origin icon — ignore.
      }
    }
    if (Notification.permission === "granted") {
      showOne()
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") showOne()
      }).catch(() => {})
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
    previewPorts,
    unreadMentions,
    clearMentions: () => setUnreadMentions(0),
    notes,
    viewerRole: () => {
      const sess = session()
      if (!sess || props.meGithubId == null) return "viewer"
      const me = sess.participants.find((p) => p.githubId === props.meGithubId)
      return me?.role ?? "viewer"
    },

    async submitPrompt(content, model, agent, variant) {
      await api("/prompt", "POST", { content, model, agent, variant })
    },
    async suggestPrompt(content, model, agent, variant) {
      await api("/suggest", "POST", { content, model, agent, variant })
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
    async react(suggestionId, emoji) {
      await api(`/react/${suggestionId}`, "POST", { emoji })
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
    async openPullRequest() {
      const res = await api("/pr", "POST")
      return res.json() as Promise<{ url: string }>
    },
    async addRepos(repos) {
      const res = await api("", "PATCH", { repos })
      const data = (await res.json()) as { added: string[] }
      // Optimistically refresh; SSE will also fire collab:repos_added.
      fetchSession()
      return data
    },
    async deleteSession() {
      await api("", "DELETE")
    },
    async postNote(content) {
      await api("/note", "POST", { content })
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
    async reinitWorkspace() {
      // Optimistically flip the local UI back to pending so the recovery
      // panel disappears and the patient-wait dialog comes back while the
      // server churns.  Server will broadcast workspace_ready / _failed
      // on completion.
      setSession((prev) =>
        prev ? { ...prev, initStatus: "pending", initError: null } : prev,
      )
      await api("/reinit", "POST")
    },

    previewState,

    async launchPreview() {
      const data = await api("/preview/launch", "POST")
      // Server returns the snapshot on 202; mirror it locally so the UI
      // flips immediately (the SSE event will arrive milliseconds later
      // and overwrite this with the same data — harmless).
      if (data && typeof data === "object" && "port" in data) {
        setPreviewState(data as PreviewStateSnapshot)
      }
    },

    async stopPreview() {
      await api("/preview/stop", "POST")
      // Clear optimistically; collab:preview_stopped will confirm.
      setPreviewState(null)
    },

    async restartPreview() {
      const data = await api("/preview/restart", "POST")
      if (data && typeof data === "object" && "port" in data) {
        setPreviewState(data as PreviewStateSnapshot)
      }
    },
  }

  return <CollabContext.Provider value={value}>{props.children}</CollabContext.Provider>
}
