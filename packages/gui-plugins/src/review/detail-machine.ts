import type { FileDiffInfo } from "@opencode/client/promise"
import type { ReviewDiffFailure } from "./machine"

/** How many times a failed bounded request runs again, after 1 s and then 2 s, before the preview shows the failure. */
export const REVIEW_DETAIL_RETRIES = 2

/**
 * Where a full patch loads from: the file's own directory, which keeps the response small, then the review root with
 * three lines of context, which fits a patch the server would otherwise leave out as too large.
 */
export type ReviewDetailStage = "scoped" | "bounded"

/** The previewed file whose listed patch has no hunks, and everything its request reads, fixed when it is chosen. */
export type ReviewDetailTarget =
  | {
      readonly kind: "turn"
      readonly serverID: string
      readonly sessionID: string
      readonly file: string
      readonly additions: number
      readonly deletions: number
      /** The listed diffs' version: diffs that load again ask for the patch again. */
      readonly version: number
    }
  | {
      readonly kind: "vcs"
      readonly serverID: string
      readonly mode: "git" | "branch"
      readonly branch: string
      readonly defaultBranch: string
      readonly root: string
      /** The file's own directory inside `root`; the same as `root` for a file at the top. */
      readonly scoped: string
      readonly file: string
      readonly additions: number
      readonly deletions: number
      readonly version: number
    }

/** What the preview needs: nothing, or the full patch of `target`. */
export type ReviewDetailContext =
  | { readonly kind: "none" }
  | {
      readonly kind: "needed"
      readonly target: ReviewDetailTarget
      readonly connected: boolean
      /** The patch an earlier request loaded for this target. */
      readonly cached?: FileDiffInfo
    }

export type ReviewDetailState =
  | { readonly status: "idle"; readonly attempt: number }
  /** The server is unreachable; the patch loads once it reconnects. */
  | { readonly status: "offline"; readonly target: ReviewDetailTarget; readonly attempt: number }
  | {
      readonly status: "loading"
      readonly target: ReviewDetailTarget
      readonly stage: ReviewDetailStage
      /** Failed bounded requests so far. */
      readonly failures: number
      readonly attempt: number
    }
  /** `diff` is undefined when the server answered but even the bounded patch had no hunks. */
  | {
      readonly status: "ready"
      readonly target: ReviewDetailTarget
      readonly attempt: number
      readonly diff: FileDiffInfo | undefined
    }
  | {
      readonly status: "error"
      readonly target: ReviewDetailTarget
      readonly attempt: number
      readonly failure: ReviewDiffFailure
    }
  | { readonly status: "disposed"; readonly attempt: number }

export type ReviewDetailEvent =
  | { readonly type: "context.changed"; readonly context: ReviewDetailContext }
  | { readonly type: "retry" }
  | { readonly type: "fetch.succeeded"; readonly attempt: number; readonly diff: FileDiffInfo | undefined }
  | { readonly type: "fetch.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "fetch.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewDetailEffect =
  /** Starts a request after `delayMs`; its deadline starts with it. */
  | {
      readonly type: "fetch"
      readonly target: ReviewDetailTarget
      readonly stage: ReviewDetailStage
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "abort"; readonly attempt: number }

export type ReviewDetailTransition = {
  readonly state: ReviewDetailState
  readonly effects: readonly ReviewDetailEffect[]
}

/** What the preview of a target shows. `diff` is undefined when the listed patch is all there is. */
export type ReviewDetailView =
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  | { readonly status: "error"; readonly failure: ReviewDiffFailure }
  | { readonly status: "ready"; readonly diff: FileDiffInfo | undefined }

export const INITIAL_REVIEW_DETAIL_STATE: ReviewDetailState = { status: "idle", attempt: 0 }

const LOADING: ReviewDetailView = { status: "loading" }

const OFFLINE: ReviewDetailView = { status: "offline" }

const NONE: readonly ReviewDetailEffect[] = []

export function transitionReviewDetail(state: ReviewDetailState, event: ReviewDetailEvent): ReviewDetailTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return leave(state, { status: "disposed", attempt: state.attempt })

  if (event.type === "context.changed") return contextChanged(state, event.context)

  if (event.type === "retry") return state.status === "error" ? start(state, state.target) : unchanged(state)

  if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "fetch.timed-out")
    return {
      state: { status: "error", target: state.target, attempt: state.attempt, failure: { type: "timeout" } },
      effects: [{ type: "abort", attempt: state.attempt }],
    }

  if (event.type === "fetch.succeeded") {
    if (event.diff || state.stage === "bounded")
      return changed({ status: "ready", target: state.target, attempt: state.attempt, diff: event.diff })

    // The file's directory answered without a usable patch: the bounded request may fit it.
    return request(state, "bounded", 0, 0)
  }

  // A scoped request can fail where the bounded one succeeds, as for a deleted directory; it is not retried.
  if (state.stage === "scoped") return request(state, "bounded", 0, 0)

  if (state.failures < REVIEW_DETAIL_RETRIES)
    return request(state, "bounded", state.failures + 1, Math.min(1000 * 2 ** state.failures, 30_000))

  return changed({
    status: "error",
    target: state.target,
    attempt: state.attempt,
    failure: { type: "rejected", message: event.message },
  })
}

/** What the preview of `target` shows; any other target's state still loads it. */
export function reviewDetailView(state: ReviewDetailState, target: ReviewDetailTarget): ReviewDetailView {
  if (!("target" in state) || !sameReviewDetailTarget(state.target, target)) return LOADING

  if (state.status === "offline") return OFFLINE

  if (state.status === "error") return { status: "error", failure: state.failure }

  if (state.status === "ready") return { status: "ready", diff: state.diff }

  return LOADING
}

export function sameReviewDetailTarget(a: ReviewDetailTarget, b: ReviewDetailTarget) {
  if (
    a.serverID !== b.serverID ||
    a.file !== b.file ||
    a.additions !== b.additions ||
    a.deletions !== b.deletions ||
    a.version !== b.version
  )
    return false

  if (a.kind === "turn") return b.kind === "turn" && a.sessionID === b.sessionID

  return (
    b.kind === "vcs" &&
    a.mode === b.mode &&
    a.branch === b.branch &&
    a.defaultBranch === b.defaultBranch &&
    a.root === b.root &&
    a.scoped === b.scoped
  )
}

function contextChanged(state: Exclude<ReviewDetailState, { status: "disposed" }>, context: ReviewDetailContext) {
  if (context.kind === "none")
    return state.status === "idle" ? unchanged(state) : leave(state, { status: "idle", attempt: state.attempt })

  const target = context.target
  const same = "target" in state && sameReviewDetailTarget(state.target, target)

  // A loaded patch stays loaded for its target, whatever the connection does.
  if (same && state.status === "ready") return unchanged(state)

  if (context.cached) return leave(state, { status: "ready", target, attempt: state.attempt, diff: context.cached })

  if (!context.connected)
    return same && state.status === "offline"
      ? unchanged(state)
      : leave(state, { status: "offline", target, attempt: state.attempt })

  // A failure stays until Try again; a disconnect in between moves it to offline, and reconnecting loads again.
  if (same && (state.status === "loading" || state.status === "error")) return unchanged(state)

  return start(state, target)
}

function start(state: ReviewDetailState, target: ReviewDetailTarget): ReviewDetailTransition {
  const attempt = state.attempt + 1
  const stage: ReviewDetailStage = target.kind === "vcs" && target.scoped !== target.root ? "scoped" : "bounded"
  const begin: ReviewDetailEffect = { type: "fetch", target, stage, attempt, delayMs: 0 }

  return {
    state: { status: "loading", target, stage, failures: 0, attempt },
    effects: state.status === "loading" ? [{ type: "abort", attempt: state.attempt }, begin] : [begin],
  }
}

function request(
  state: Extract<ReviewDetailState, { status: "loading" }>,
  stage: ReviewDetailStage,
  failures: number,
  delayMs: number,
): ReviewDetailTransition {
  const attempt = state.attempt + 1

  return {
    state: { status: "loading", target: state.target, stage, failures, attempt },
    effects: [{ type: "fetch", target: state.target, stage, attempt, delayMs }],
  }
}

/** Moves to a state that runs no request, ending the running one. */
function leave(state: ReviewDetailState, next: ReviewDetailState): ReviewDetailTransition {
  return { state: next, effects: state.status === "loading" ? [{ type: "abort", attempt: state.attempt }] : NONE }
}

function changed(state: ReviewDetailState): ReviewDetailTransition {
  return { state, effects: NONE }
}

function unchanged(state: ReviewDetailState): ReviewDetailTransition {
  return { state, effects: NONE }
}
