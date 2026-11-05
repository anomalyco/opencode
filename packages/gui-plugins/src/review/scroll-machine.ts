/** How many animation frames a focused file may take to render before the narrow review stops scrolling to it. */
export const REVIEW_SCROLL_MAX_FRAMES = 60

/** What decides whether the narrow review can scroll to a file now. */
export type ReviewScrollContext = {
  /** The routing visit of the session the review shows; a focused file belongs to its visit. */
  readonly visitID: number
  /** Only the narrow review scrolls its list to a file; the wide panel previews one file. */
  readonly narrow: boolean
  /** The narrow review's list is mounted. */
  readonly scroller: boolean
  /** The diffs have loaded. */
  readonly ready: boolean
}

export type ReviewScrollState =
  | { readonly status: "idle"; readonly context: ReviewScrollContext; readonly attempt: number }
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
  | { readonly status: "disposed"; readonly attempt: number }

export type ReviewScrollEvent =
  | { readonly type: "context.synced"; readonly context: ReviewScrollContext }
  | { readonly type: "file.focused"; readonly path: string }
  /** A scheduled frame scrolled toward the file: `settled` once its diff stays at the top. */
  | { readonly type: "frame.stepped"; readonly attempt: number; readonly outcome: "settled" | "retry" }
  /** The user scrolled, pressed a key or touched the list. */
  | { readonly type: "interacted" }
  | { readonly type: "disposed" }

export type ReviewScrollEffect =
  | { readonly type: "frame.schedule"; readonly attempt: number; readonly path: string }
  | { readonly type: "frame.cancel" }

export type ReviewScrollTransition = {
  readonly state: ReviewScrollState
  readonly effects: readonly ReviewScrollEffect[]
}

type Active = Exclude<ReviewScrollState, { status: "disposed" }>

export const INITIAL_REVIEW_SCROLL_STATE: ReviewScrollState = {
  status: "idle",
  context: { visitID: 0, narrow: false, scroller: false, ready: false },
  attempt: 0,
}

const NONE: readonly ReviewScrollEffect[] = []

const CANCEL: readonly ReviewScrollEffect[] = [{ type: "frame.cancel" }]

export function transitionReviewScroll(state: ReviewScrollState, event: ReviewScrollEvent): ReviewScrollTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return stop(state, { status: "disposed", attempt: state.attempt + 1 })

  if (event.type === "context.synced") return synced(state, event.context)

  if (event.type === "file.focused") {
    // The wide panel previews the file itself; nothing waits to scroll a list that may mount much later.
    if (!state.context.narrow) return unchanged(state)
    const attempt = state.attempt + 1
    const cancel = state.status === "scrolling" ? CANCEL : NONE

    if (!scrollable(state.context))
      return { state: { status: "waiting", context: state.context, path: event.path, attempt }, effects: cancel }

    return scroll(state.context, event.path, attempt, cancel)
  }

  if (event.type === "interacted")
    return state.status === "idle"
      ? unchanged(state)
      : stop(state, { status: "idle", context: state.context, attempt: state.attempt + 1 })

  if (state.status !== "scrolling" || event.attempt !== state.attempt) return unchanged(state)

  if (event.outcome === "settled" || state.retries >= REVIEW_SCROLL_MAX_FRAMES)
    return changed({ status: "idle", context: state.context, attempt: state.attempt })

  return {
    state: { ...state, retries: state.retries + 1 },
    effects: [{ type: "frame.schedule", attempt: state.attempt, path: state.path }],
  }
}

export function sameReviewScrollContext(a: ReviewScrollContext, b: ReviewScrollContext) {
  return a.visitID === b.visitID && a.narrow === b.narrow && a.scroller === b.scroller && a.ready === b.ready
}

function synced(state: Active, context: ReviewScrollContext): ReviewScrollTransition {
  if (sameReviewScrollContext(state.context, context)) return unchanged(state)

  if (state.status === "idle") return changed({ ...state, context })

  // A focused file belongs to its visit and to the narrow review.
  if (context.visitID !== state.context.visitID || !context.narrow)
    return stop(state, { status: "idle", context, attempt: state.attempt + 1 })

  if (state.status === "waiting")
    return scrollable(context) ? scroll(context, state.path, state.attempt + 1, NONE) : changed({ ...state, context })

  // The list unmounted or the diffs reload: the file's position is unknown again.
  if (!scrollable(context)) return stop(state, { status: "idle", context, attempt: state.attempt + 1 })

  return changed({ ...state, context })
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

/** Moves to a state that scrolls no more, cancelling a scheduled frame. */
function stop(state: Active, next: ReviewScrollState): ReviewScrollTransition {
  return { state: next, effects: state.status === "scrolling" ? CANCEL : NONE }
}

function scrollable(context: ReviewScrollContext) {
  return context.narrow && context.scroller && context.ready
}

function changed(state: ReviewScrollState): ReviewScrollTransition {
  return { state, effects: NONE }
}

function unchanged(state: ReviewScrollState): ReviewScrollTransition {
  return { state, effects: NONE }
}
