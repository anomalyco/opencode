/** How many animation frames a focused file may take to render before the narrow review stops scrolling to it. */
export const REVIEW_SCROLL_MAX_FRAMES = 60

/** What decides whether the narrow review can restore its scroll or scroll to a file now. */
export type ReviewScrollContext = {
  /** The routing visit of the session the review shows; a restore and a focused file belong to their visit. */
  readonly visitID: number
  /** Only the narrow review scrolls its list; the wide panel previews one file. */
  readonly narrow: boolean
  /** The narrow review's list is mounted. */
  readonly scroller: boolean
  /** The diffs have loaded. */
  readonly ready: boolean
  /** The layout loaded, so the stored scroll can be read and written. */
  readonly layoutReady: boolean
  /** A review comment is focused; the review centers it itself. */
  readonly commentFocused: boolean
}

export type ReviewScrollState =
  /**
   * The list returns to the stored scroll as its diffs render, until the user scrolls, a file is focused or a comment
   * is. Scroll events the restore or a layout change fires leave it restoring and are not stored.
   */
  | {
      readonly status: "restoring"
      readonly context: ReviewScrollContext
      /** A restore frame is scheduled. */
      readonly restoreQueued: boolean
      readonly attempt: number
    }
  /** A file was focused on a narrow screen; waits for the list and the diffs. */
  | {
      readonly status: "waiting"
      readonly context: ReviewScrollContext
      readonly path: string
      readonly attempt: number
    }
  /** Scrolls a frame at a time until the file's diff stays at the top, at most `REVIEW_SCROLL_MAX_FRAMES` more frames. */
  | {
      readonly status: "scrolling"
      readonly context: ReviewScrollContext
      readonly path: string
      readonly retries: number
      readonly attempt: number
    }
  /** The user, a focused file or a focused comment placed the list; its scroll is stored. */
  | { readonly status: "settled"; readonly context: ReviewScrollContext; readonly attempt: number }
  | { readonly status: "disposed"; readonly attempt: number }

export type ReviewScrollEvent =
  | { readonly type: "context.synced"; readonly context: ReviewScrollContext }
  /** The list mounted, or its diffs or wrapping changed: restore the stored scroll again. */
  | { readonly type: "restore.requested" }
  /** The restore frame scheduled for `attempt` ran. */
  | { readonly type: "restore.stepped"; readonly attempt: number }
  | { readonly type: "file.focused"; readonly path: string }
  /** A scheduled frame scrolled toward the file: `settled` once its diff stays at the top. */
  | { readonly type: "frame.stepped"; readonly attempt: number; readonly outcome: "settled" | "retry" }
  /** The user scrolled, pressed a key, touched the list or opened or closed a diff. */
  | { readonly type: "interacted" }
  | { readonly type: "disposed" }

export type ReviewScrollEffect =
  /** Restores the stored scroll on the next frame. */
  | { readonly type: "frame.restore"; readonly attempt: number }
  | { readonly type: "frame.schedule"; readonly attempt: number; readonly path: string }
  | { readonly type: "frame.cancel" }

export type ReviewScrollTransition = {
  readonly state: ReviewScrollState
  readonly effects: readonly ReviewScrollEffect[]
}

type Active = Exclude<ReviewScrollState, { status: "disposed" }>

export const INITIAL_REVIEW_SCROLL_STATE: ReviewScrollState = {
  status: "restoring",
  context: { visitID: 0, narrow: false, scroller: false, ready: false, layoutReady: false, commentFocused: false },
  restoreQueued: false,
  attempt: 0,
}

/** Reused on every input event, so the hot path allocates nothing. */
export const REVIEW_SCROLL_INTERACTED: ReviewScrollEvent = { type: "interacted" }

export const REVIEW_SCROLL_RESTORE_REQUESTED: ReviewScrollEvent = { type: "restore.requested" }

const NONE: readonly ReviewScrollEffect[] = []

const CANCEL: readonly ReviewScrollEffect[] = [{ type: "frame.cancel" }]

export function transitionReviewScroll(state: ReviewScrollState, event: ReviewScrollEvent): ReviewScrollTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return stop(state, { status: "disposed", attempt: state.attempt + 1 })

  if (event.type === "context.synced") return synced(state, event.context)

  if (event.type === "restore.requested")
    return state.status === "restoring" && !state.restoreQueued && restorable(state.context)
      ? restore(state.context, state.attempt + 1, NONE)
      : unchanged(state)

  if (event.type === "restore.stepped")
    return state.status === "restoring" && state.restoreQueued && event.attempt === state.attempt
      ? changed({ ...state, restoreQueued: false })
      : unchanged(state)

  if (event.type === "file.focused") {
    // The wide panel previews the file itself; nothing waits to scroll a list that may mount much later.
    if (!state.context.narrow) return unchanged(state)
    const attempt = state.attempt + 1
    const cancel = framed(state) ? CANCEL : NONE

    if (!scrollable(state.context))
      return { state: { status: "waiting", context: state.context, path: event.path, attempt }, effects: cancel }

    return scroll(state.context, event.path, attempt, cancel)
  }

  if (event.type === "interacted")
    return state.status === "settled" || !state.context.narrow ? unchanged(state) : settle(state, state.context)

  if (state.status !== "scrolling" || event.attempt !== state.attempt) return unchanged(state)

  if (event.outcome === "settled" || state.retries >= REVIEW_SCROLL_MAX_FRAMES)
    return changed({ status: "settled", context: state.context, attempt: state.attempt })

  return {
    state: { ...state, retries: state.retries + 1 },
    effects: [{ type: "frame.schedule", attempt: state.attempt, path: state.path }],
  }
}

/** Whether the restore frame scheduled for `attempt` may still move the list. */
export function canRestoreReviewScroll(state: ReviewScrollState, attempt: number) {
  return state.status === "restoring" && state.restoreQueued && state.attempt === attempt && restorable(state.context)
}

/** Whether a scroll event's position is the user's to store. */
export function canSaveReviewScroll(state: ReviewScrollState) {
  return state.status === "settled" && restorable(state.context)
}

export function sameReviewScrollContext(a: ReviewScrollContext, b: ReviewScrollContext) {
  return (
    a.visitID === b.visitID &&
    a.narrow === b.narrow &&
    a.scroller === b.scroller &&
    a.ready === b.ready &&
    a.layoutReady === b.layoutReady &&
    a.commentFocused === b.commentFocused
  )
}

function synced(state: Active, context: ReviewScrollContext): ReviewScrollTransition {
  if (sameReviewScrollContext(state.context, context)) return unchanged(state)
  const cancel = framed(state) ? CANCEL : NONE

  // A restore and a focused file belong to their visit; the next visit restores its own scroll.
  if (context.visitID !== state.context.visitID) {
    if (context.commentFocused) return settle(state, context)

    return restorable(context)
      ? restore(context, state.attempt + 1, cancel)
      : { state: { status: "restoring", context, restoreQueued: false, attempt: state.attempt + 1 }, effects: cancel }
  }

  // The wide panel scrolls no list; the narrow list restores again once it mounts.
  if (!context.narrow) {
    if (state.status === "restoring" && !state.restoreQueued) return changed({ ...state, context })

    return {
      state: { status: "restoring", context, restoreQueued: false, attempt: state.attempt + 1 },
      effects: cancel,
    }
  }

  if (state.status === "waiting")
    return scrollable(context) ? scroll(context, state.path, state.attempt + 1, NONE) : changed({ ...state, context })

  if (state.status === "scrolling") {
    if (scrollable(context)) return changed({ ...state, context })

    // The list unmounted, and restores once it mounts again; or the diffs reload and the file's position is unknown.
    return {
      state: context.scroller
        ? { status: "settled", context, attempt: state.attempt + 1 }
        : { status: "restoring", context, restoreQueued: false, attempt: state.attempt + 1 },
      effects: CANCEL,
    }
  }

  // The list remounted on the same visit, as when the narrow review's tab opens again.
  if (state.status === "settled")
    return changed(
      context.scroller
        ? { ...state, context }
        : { status: "restoring", context, restoreQueued: false, attempt: state.attempt },
    )

  // The focused comment's position wins over the stored scroll.
  if (context.commentFocused) return settle(state, context)

  if (!restorable(context))
    return { state: { ...state, context, restoreQueued: false }, effects: state.restoreQueued ? CANCEL : NONE }

  if (!state.restoreQueued && !restorable(state.context)) return restore(context, state.attempt + 1, NONE)

  return changed({ ...state, context })
}

function restore(
  context: ReviewScrollContext,
  attempt: number,
  cancel: readonly ReviewScrollEffect[],
): ReviewScrollTransition {
  return {
    state: { status: "restoring", context, restoreQueued: true, attempt },
    effects: [...cancel, { type: "frame.restore", attempt }],
  }
}

function scroll(
  context: ReviewScrollContext,
  path: string,
  attempt: number,
  cancel: readonly ReviewScrollEffect[],
): ReviewScrollTransition {
  return {
    state: { status: "scrolling", context, path, retries: 0, attempt },
    effects: [...cancel, { type: "frame.schedule", attempt, path }],
  }
}

function settle(state: Active, context: ReviewScrollContext): ReviewScrollTransition {
  return stop(state, { status: "settled", context, attempt: state.attempt + 1 })
}

/** Moves to a state that schedules no frame, cancelling a scheduled one. */
function stop(state: Active, next: ReviewScrollState): ReviewScrollTransition {
  return { state: next, effects: framed(state) ? CANCEL : NONE }
}

/** Whether a restore or scroll frame is scheduled. */
function framed(state: Active) {
  return (state.status === "restoring" && state.restoreQueued) || state.status === "scrolling"
}

function scrollable(context: ReviewScrollContext) {
  return context.narrow && context.scroller && context.ready
}

function restorable(context: ReviewScrollContext) {
  return context.narrow && context.scroller && context.layoutReady
}

function changed(state: ReviewScrollState): ReviewScrollTransition {
  return { state, effects: NONE }
}

function unchanged(state: ReviewScrollState): ReviewScrollTransition {
  return { state, effects: NONE }
}
