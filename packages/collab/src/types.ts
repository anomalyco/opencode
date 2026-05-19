export type CollabRole = "driver" | "contributor" | "viewer"

export type VisibilityMode = "submitted" | "typing" | "live"

export type QueueMode = "fifo" | "vote"

export type SuggestionStatus = "pending" | "approved" | "rejected"

export interface CollabSession {
  id: string
  name: string
  ownerGithubId: number
  ownerGithubLogin: string
  visibilityMode: VisibilityMode
  queueMode: QueueMode
  /** FK to opencode's native Session (null until the session is started) */
  sessionId: string | null
  repos: string[]
  participants: Participant[]
  createdAt: Date
  deletedAt: Date | null
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
