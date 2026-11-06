/** How long `vcs.init`, and then the cache refresh after it, may each run before the button is released. */
export const REVIEW_INIT_GIT_TIMEOUT_MS = 30_000

/** One session's Git initialization; a session without an entry offers the button. */
export type ReviewInitGitEntry =
  /** `vcs.init` is running. */
  | { readonly status: "initializing"; readonly attempt: number }
  /** The repository exists; the session, project and location caches refresh so the review shows it. */
  | { readonly status: "syncing"; readonly attempt: number }

export type ReviewInitGitState =
  | {
      readonly status: "active"
      /** The last attempt id handed out, across sessions. */
      readonly issued: number
      readonly sessions: Readonly<Record<string, ReviewInitGitEntry>>
    }
  | { readonly status: "disposed" }

export type ReviewInitGitEvent =
  /** The user asked to create a repository; `ready` when the session's location and server are known. */
  | { readonly type: "init.requested"; readonly sessionKey: string; readonly ready: boolean }
  | { readonly type: "init.succeeded"; readonly sessionKey: string; readonly attempt: number }
  /** `routedSessionKey` is the session the review shows when the failure arrives; only that one reports it. */
  | {
      readonly type: "init.failed"
      readonly sessionKey: string
      readonly attempt: number
      readonly routedSessionKey: string
      readonly message?: string
    }
  | {
      readonly type: "init.timed-out"
      readonly sessionKey: string
      readonly attempt: number
      readonly routedSessionKey: string
    }
  /** Every cache refresh settled, whether or not it succeeded. */
  | { readonly type: "sync.settled"; readonly sessionKey: string; readonly attempt: number }
  | { readonly type: "sync.timed-out"; readonly sessionKey: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewInitGitEffect =
  | { readonly type: "vcs.init"; readonly sessionKey: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "caches.sync"; readonly sessionKey: string; readonly attempt: number; readonly timeoutMs: number }
  /** Clears the attempt's timer and aborts its requests. */
  | { readonly type: "attempt.abort"; readonly attempt: number }
  | {
      readonly type: "toast.failed"
      readonly reason: "unavailable" | "rejected" | "timeout"
      readonly message?: string
    }

export type ReviewInitGitTransition = {
  readonly state: ReviewInitGitState
  readonly effects: readonly ReviewInitGitEffect[]
}

const NONE: readonly ReviewInitGitEffect[] = []

export function createReviewInitGitState(): ReviewInitGitState {
  return { status: "active", issued: 0, sessions: {} }
}

export function transitionReviewInitGit(state: ReviewInitGitState, event: ReviewInitGitEvent): ReviewInitGitTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: Object.values(state.sessions).map((entry) => ({ type: "attempt.abort", attempt: entry.attempt })),
    }

  const entry = state.sessions[event.sessionKey]

  if (event.type === "init.requested") {
    // A second click while the first runs does nothing.
    if (entry) return unchanged(state)

    if (!event.ready) return { state, effects: [{ type: "toast.failed", reason: "unavailable" }] }
    const attempt = state.issued + 1

    return {
      state: {
        status: "active",
        issued: attempt,
        sessions: { ...state.sessions, [event.sessionKey]: { status: "initializing", attempt } },
      },
      effects: [{ type: "vcs.init", sessionKey: event.sessionKey, attempt, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS }],
    }
  }

  if (!entry || entry.attempt !== event.attempt) return unchanged(state)

  if (event.type === "init.succeeded") {
    if (entry.status !== "initializing") return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: {
        status: "active",
        issued: attempt,
        sessions: { ...state.sessions, [event.sessionKey]: { status: "syncing", attempt } },
      },
      effects: [
        { type: "attempt.abort", attempt: entry.attempt },
        { type: "caches.sync", sessionKey: event.sessionKey, attempt, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "init.failed" || event.type === "init.timed-out") {
    if (entry.status !== "initializing") return unchanged(state)
    const abort: ReviewInitGitEffect = { type: "attempt.abort", attempt: entry.attempt }
    // Another session's failure is not shown over the routed one.
    const routed = event.routedSessionKey === event.sessionKey

    return {
      state: release(state, event.sessionKey),
      effects: !routed
        ? [abort]
        : [
            abort,
            event.type === "init.failed"
              ? { type: "toast.failed", reason: "rejected", message: event.message }
              : { type: "toast.failed", reason: "timeout" },
          ],
    }
  }

  // The repository already exists; a refresh that failed or ran long is not a failed initialization.
  if (entry.status !== "syncing") return unchanged(state)

  return { state: release(state, event.sessionKey), effects: [{ type: "attempt.abort", attempt: entry.attempt }] }
}

/** Whether the session's "Create a Git repository" button is busy. */
export function isInitializingGit(state: ReviewInitGitState, sessionKey: string) {
  return state.status === "active" && state.sessions[sessionKey] !== undefined
}

function release(state: Extract<ReviewInitGitState, { status: "active" }>, sessionKey: string): ReviewInitGitState {
  return {
    status: "active",
    issued: state.issued,
    sessions: Object.fromEntries(Object.entries(state.sessions).filter(([key]) => key !== sessionKey)),
  }
}

function unchanged(state: ReviewInitGitState): ReviewInitGitTransition {
  return { state, effects: NONE }
}
