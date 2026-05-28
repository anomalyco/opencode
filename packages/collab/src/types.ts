export type CollabRole = "driver" | "contributor" | "viewer"

/**
 * How much of a participant's pre-submit activity is visible to others.
 *   "submitted" — others only see the prompt once it has been sent
 *   "typing"   — others see a "[name] is typing…" indicator (no content)
 *
 * NOTE: a previous "live" mode that broadcast keystroke-by-keystroke drafts
 * has been removed; the keystroke event type is retained for back-compat
 * deserialization but is never emitted by the server anymore.
 */
export type VisibilityMode = "submitted" | "typing"

export type QueueMode = "fifo" | "vote"

/** "submitted" means the prompt has been dispatched to the LLM; it is no longer in the approved queue. */
export type SuggestionStatus = "pending" | "approved" | "rejected" | "submitted"

/**
 * Server-side workspace lifecycle state.
 *   "pending"  — initSessionWorkspace is in flight (cloning repos, checking
 *                out the collab branch, pre-warming the native session).
 *   "ready"    — workspace is fully populated and the native session is
 *                created.  Iframe is safe to mount.
 *   "failed"   — initSessionWorkspace threw and recovery wasn't possible.
 *                A Driver can POST /collab/session/:id/reinit to retry.
 */
export type WorkspaceInitStatus = "pending" | "ready" | "failed"

export interface CollabSession {
  id: string
  name: string
  ownerGithubId: number
  ownerGithubLogin: string
  visibilityMode: VisibilityMode
  queueMode: QueueMode
  /** FK to opencode's native Session (null until the session is started) */
  sessionId: string | null
  /** Git branch every linked repo is checked out to for this collab session. */
  branch: string | null
  repos: string[]
  /**
   * Live-read git branch per repo (keyed by `<org>/<repo>`).  Reflects the
   * actual current HEAD of each cloned working copy — so legacy sessions
   * created before `branch` existed still surface their real branch in the
   * UI.  Empty object if no repos are cloned yet.
   */
  repoBranches?: Record<string, string>
  participants: Participant[]
  createdAt: Date
  deletedAt: Date | null
  /**
   * Server-side workspace init state.  See WorkspaceInitStatus.
   * Optional in the wire format because legacy clients/servers predate it;
   * absence is interpreted as "ready" (legacy sessions are by definition
   * already initialised by the time you see them).
   */
  initStatus?: WorkspaceInitStatus
  /** Short human-readable error message — set when initStatus === "failed". */
  initError?: string | null
}

export interface Participant {
  githubId: number
  githubLogin: string
  githubAvatarUrl: string
  role: CollabRole
  isOnline: boolean
  joinedAt: Date
}

export interface PromptSuggestion {
  id: string
  collabSessionId: string
  authorGithubId: number
  authorGithubLogin: string
  content: string
  status: SuggestionStatus
  voteScore: number
  votes: string[] // array of githubLogins who voted
  /** Emoji reactions on this suggestion: { "🔥": ["alice","bob"], "👎": ["carol"] }. */
  reactions?: Record<string, string[]>
  createdAt: Date
  /** Model the author had selected when submitting (e.g. "anthropic/claude-sonnet-4-5"). */
  model?: string
  /** Agent the author had selected (e.g. "build", "plan"). */
  agent?: string
  /** Model variant the author had selected (e.g. "extended"). */
  variant?: string
}

/** Allowed reaction emoji set — keep this small so the UI bar stays compact. */
export const REACTION_EMOJIS = ["👍", "👎", "🔥", "🚀", "❤️", "😄"] as const
export type ReactionEmoji = typeof REACTION_EMOJIS[number]

/**
 * A side-channel team note — short human-to-human message visible to all
 * participants of a collab session, separate from prompt suggestions.
 * Notes do NOT dispatch to the LLM; they exist so the team can ping each
 * other (e.g. `@bob can you check this diff?`) without burning a turn.
 */
export interface CollabNote {
  id: string
  collabSessionId: string
  authorGithubId: number
  authorGithubLogin: string
  content: string
  createdAt: Date
}

export interface InviteToken {
  token: string
  collabSessionId: string
  role: CollabRole
  createdBy: string
  expiresAt: Date | null
  usedAt: Date | null
}

// WebSocket message types broadcast to all Collab Session participants

export type CollabEvent =
  | { type: "collab:participant_joined"; participant: Participant }
  | { type: "collab:participant_left"; githubLogin: string }
  | { type: "collab:role_changed"; githubLogin: string; role: CollabRole }
  | { type: "collab:prompt_submitted"; suggestion: PromptSuggestion; queuePosition: number }
  | { type: "collab:prompt_suggestion"; suggestion: PromptSuggestion }
  | { type: "collab:suggestion_approved"; suggestionId: string; approvedBy: string }
  | { type: "collab:suggestion_rejected"; suggestionId: string; rejectedBy: string }
  | { type: "collab:vote_cast"; suggestionId: string; voterLogin: string; newScore: number }
  | { type: "collab:vote_winner"; suggestionId: string; content: string }
  | { type: "collab:queue_update"; queue: PromptSuggestion[] }
  | { type: "collab:typing_start"; githubLogin: string }
  | { type: "collab:typing_stop"; githubLogin: string }
  | { type: "collab:keystroke"; githubLogin: string; draft: string }
  | { type: "collab:session_deleted"; collabSessionId: string }
  | { type: "collab:native_session_linked"; sessionId: string; directory: string }
  | { type: "collab:reaction_changed"; suggestionId: string; reactions: Record<string, string[]> }
  | {
      type: "collab:mention"
      /** GitHub login of the person who was mentioned. */
      mentionedLogin: string
      /** GitHub login of the person who wrote the mention. */
      authorLogin: string
      /** Where it came from — either an LLM-bound suggestion or a team note. */
      context:
        | { kind: "suggestion"; suggestionId: string; excerpt: string }
        | { kind: "note"; noteId: string; excerpt: string }
    }
  | { type: "collab:note_added"; note: CollabNote }
  | { type: "collab:repos_added"; repos: string[]; addedBy: string }
  /**
   * The collab session's server-side workspace (git clone + branch checkout +
   * native opencode session pre-warm) is fully ready.  The iframe SHOULD NOT
   * mount before this fires — see docs/adr/0001 and pages/collab/session.tsx
   * for the gating logic.
   */
  | { type: "collab:workspace_ready"; collabSessionId: string }
  /**
   * Workspace init failed.  Carries a short human-readable reason so the
   * recovery panel can display it.  Driver can re-trigger via
   * POST /collab/session/:id/reinit.
   */
  | { type: "collab:workspace_failed"; collabSessionId: string; error: string }
