import type { FileDiffInfo } from "@opencode/client/promise"

/** How long a diff request may run before the review shows it failed, so a wedged server never loads forever. */
export const REVIEW_DIFF_TIMEOUT_MS = 30_000

/** What one diff request reads: a directory's changes against the working tree or branch, or a session's last turn. */
export type ReviewDiffTarget =
  | {
      readonly kind: "vcs"
      readonly serverID: string
      readonly directory: string
      readonly mode: "git" | "branch"
      readonly branch: string
      readonly defaultBranch: string
    }
  | { readonly kind: "turn"; readonly serverID: string; readonly sessionID: string }

/** Diffs loaded once for a target, with the version that tells their detail requests apart. */
export type ReviewDiffRows = { readonly rows: readonly FileDiffInfo[]; readonly version: number }

/** What the routed session lets the review request. */
export type ReviewDiffContext =
  /** The session store has not loaded, or the connected server has not sent the project: the mode is not known yet. */
  | { readonly kind: "waiting" }
  /** The project has no repository. */
  | { readonly kind: "no-vcs" }
  /** The server is disconnected before it sent the project. */
  | { readonly kind: "offline" }
  | {
      readonly kind: "ready"
      readonly target: ReviewDiffTarget
      readonly connected: boolean
      /** Something shows the changes: the review panel, a change tree or file markers. */
      readonly demanded: boolean
      /** Diffs an earlier request loaded for this target, shown while they load again. */
      readonly cached?: ReviewDiffRows
    }

export type ReviewDiffFailure = { readonly type: "rejected"; readonly message: string } | { readonly type: "timeout" }

type Link = {
  readonly target: ReviewDiffTarget
  readonly connected: boolean
  readonly demanded: boolean
  /** The last request's number; a result for any other number is stale. */
  readonly attempt: number
}

export type ReviewDiffState =
  | { readonly status: "waiting"; readonly attempt: number }
  | { readonly status: "no-vcs"; readonly attempt: number }
  | { readonly status: "offline"; readonly attempt: number }
  /** Nothing loaded and no request running: the server is disconnected, or nothing shows the changes. */
  | (Link & { readonly status: "idle" })
  | (Link & { readonly status: "loading" })
  | (Link & { readonly status: "ready" } & ReviewDiffRows)
  /** Loads again while the diffs already loaded stay shown. */
  | (Link & { readonly status: "refreshing" } & ReviewDiffRows)
  | (Link & { readonly status: "error"; readonly failure: ReviewDiffFailure })
  | { readonly status: "disposed"; readonly attempt: number }

export type ReviewDiffEvent =
  | { readonly type: "context.changed"; readonly context: ReviewDiffContext }
  /** The side region opened on a wide screen; loads the changes once so the review tab can count them. */
  | { readonly type: "side.opened" }
  | { readonly type: "window.focused" }
  /** Files changed in the directory (`vcs`), or the session finished a turn (`turn`). */
  | { readonly type: "refresh"; readonly source: ReviewDiffTarget["kind"] }
  | { readonly type: "retry" }
  | { readonly type: "fetch.succeeded"; readonly attempt: number; readonly rows: ReviewDiffRows }
  | { readonly type: "fetch.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "fetch.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewDiffEffect =
  /** Starts a request, replacing any running one. */
  { readonly type: "fetch"; readonly target: ReviewDiffTarget; readonly attempt: number } | { readonly type: "abort" }

export type ReviewDiffTransition = { readonly state: ReviewDiffState; readonly effects: readonly ReviewDiffEffect[] }

/** What the review panel shows. */
export type ReviewDiffView =
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  | { readonly status: "no-vcs" }
  | { readonly status: "error"; readonly failure: ReviewDiffFailure }
  | ({ readonly status: "ready" } & ReviewDiffRows)

type Linked = Extract<ReviewDiffState, Link>

export const INITIAL_REVIEW_DIFF_STATE: ReviewDiffState = { status: "waiting", attempt: 0 }

const LOADING: ReviewDiffView = { status: "loading" }

const OFFLINE: ReviewDiffView = { status: "offline" }

const NO_VCS: ReviewDiffView = { status: "no-vcs" }

const NONE: readonly ReviewDiffEffect[] = []

const ABORT: readonly ReviewDiffEffect[] = [{ type: "abort" }]

export function transitionReviewDiff(state: ReviewDiffState, event: ReviewDiffEvent): ReviewDiffTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return leave(state, { status: "disposed", attempt: state.attempt })

  if (event.type === "context.changed") return contextChanged(state, event.context)

  if (!linked(state)) return unchanged(state)

  const enabled = state.connected && state.demanded

  // Loads even while nothing shows the changes, so the review tab can count them.
  if (event.type === "side.opened")
    return state.connected && !inFlight(state) ? fetch(state, state, rowsOf(state)) : unchanged(state)

  if (event.type === "window.focused")
    return enabled && state.target.kind === "vcs" && (state.status === "ready" || state.status === "error")
      ? fetch(state, state, rowsOf(state))
      : unchanged(state)

  // Changed files restart a running request, so its answer cannot predate the change.
  if (event.type === "refresh")
    return enabled && state.target.kind === event.source ? fetch(state, state, rowsOf(state)) : unchanged(state)

  if (event.type === "retry")
    return state.status === "error" && state.connected ? fetch(state, state, undefined) : unchanged(state)

  if (!inFlight(state) || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "fetch.succeeded") return changed({ ...link(state), status: "ready", ...event.rows })

  // A failed refresh keeps the diffs already shown.
  if (state.status === "refreshing")
    return changed({ ...link(state), status: "ready", rows: state.rows, version: state.version })

  return changed({
    ...link(state),
    status: "error",
    failure: event.type === "fetch.timed-out" ? { type: "timeout" } : { type: "rejected", message: event.message },
  })
}

export function reviewDiffView(state: ReviewDiffState): ReviewDiffView {
  if (state.status === "offline") return OFFLINE

  if (state.status === "no-vcs") return NO_VCS

  if (state.status === "idle") return state.connected ? LOADING : OFFLINE

  if (state.status === "error") return { status: "error", failure: state.failure }

  if (state.status === "ready" || state.status === "refreshing")
    return { status: "ready", rows: state.rows, version: state.version }

  return LOADING
}

/** Whether the review knows what to show: diffs, or that the project has no repository. */
export function reviewDiffReady(state: ReviewDiffState) {
  return state.status === "ready" || state.status === "refreshing" || state.status === "no-vcs"
}

export function sameReviewDiffTarget(a: ReviewDiffTarget, b: ReviewDiffTarget) {
  if (a.kind === "turn") return b.kind === "turn" && a.serverID === b.serverID && a.sessionID === b.sessionID

  if (b.kind === "turn") return false

  return (
    a.serverID === b.serverID &&
    a.directory === b.directory &&
    a.mode === b.mode &&
    a.branch === b.branch &&
    a.defaultBranch === b.defaultBranch
  )
}

function contextChanged(state: Exclude<ReviewDiffState, { status: "disposed" }>, context: ReviewDiffContext) {
  if (context.kind !== "ready")
    return state.status === context.kind
      ? unchanged(state)
      : leave(state, { status: context.kind, attempt: state.attempt })

  const next: Link = {
    target: context.target,
    connected: context.connected,
    demanded: context.demanded,
    attempt: state.attempt,
  }

  const enabled = next.connected && next.demanded

  // Another target starts over from what an earlier request loaded for it, if anything.
  if (!linked(state) || !sameReviewDiffTarget(state.target, next.target)) {
    if (enabled) return fetch(state, next, context.cached)

    return leave(state, context.cached ? { ...next, status: "ready", ...context.cached } : { ...next, status: "idle" })
  }

  if (state.connected === next.connected && state.demanded === next.demanded) return unchanged(state)

  // A disconnect ends the request; what loaded stays shown.
  if (!next.connected) {
    const rows = rowsOf(state)

    return leave(state, rows ? { ...next, status: "ready", ...rows } : { ...next, status: "idle" })
  }

  // Becoming shown, or reconnecting while shown, loads again.
  if (enabled && !(state.connected && state.demanded) && !inFlight(state)) return fetch(state, next, rowsOf(state))

  return changed({ ...state, connected: next.connected, demanded: next.demanded })
}

function fetch(state: ReviewDiffState, next: Link, rows: ReviewDiffRows | undefined): ReviewDiffTransition {
  const attempt = state.attempt + 1
  const start: ReviewDiffEffect = { type: "fetch", target: next.target, attempt }

  return {
    state: rows
      ? { ...link(next), attempt, status: "refreshing", ...rows }
      : { ...link(next), attempt, status: "loading" },
    effects: inFlight(state) ? [...ABORT, start] : [start],
  }
}

/** Moves to a state that runs no request, ending the running one. */
function leave(state: ReviewDiffState, next: ReviewDiffState): ReviewDiffTransition {
  return { state: next, effects: inFlight(state) ? ABORT : NONE }
}

function link(state: Link): Link {
  return { target: state.target, connected: state.connected, demanded: state.demanded, attempt: state.attempt }
}

function linked(state: ReviewDiffState): state is Linked {
  return "target" in state
}

function inFlight(state: ReviewDiffState) {
  return state.status === "loading" || state.status === "refreshing"
}

function rowsOf(state: ReviewDiffState): ReviewDiffRows | undefined {
  if (state.status !== "ready" && state.status !== "refreshing") return undefined

  return { rows: state.rows, version: state.version }
}

function changed(state: ReviewDiffState): ReviewDiffTransition {
  return { state, effects: NONE }
}

function unchanged(state: ReviewDiffState): ReviewDiffTransition {
  return { state, effects: NONE }
}
