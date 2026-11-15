export const REVIEW_FOCUS_TIMEOUT_MS = 2000

/** A parent's request to reveal one saved comment. `attempt` grows with each new target, so a late result or acknowledgement of an older target is ignored. */
export type ReviewFocusState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "revealing"; readonly attempt: number; readonly file: string; readonly commentId: string }
  | {
      readonly status: "settled"
      readonly attempt: number
      readonly file: string
      readonly commentId: string
      readonly outcome: "revealed" | "unavailable" | "timeout"
    }

export type ReviewFocusEvent =
  | { readonly type: "focus.requested"; readonly file: string; readonly commentId: string; readonly available: boolean }
  | { readonly type: "focus.cleared" }
  | { readonly type: "reveal.succeeded"; readonly attempt: number }
  | { readonly type: "reveal.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewFocusEffect =
  | { readonly type: "cancel-reveal" }
  | { readonly type: "open-comment"; readonly file: string; readonly commentId: string }
  | { readonly type: "expand-file"; readonly file: string }
  | { readonly type: "reveal"; readonly attempt: number }
  | { readonly type: "acknowledge"; readonly attempt: number; readonly deferred: boolean }

export type ReviewFocusTransition = {
  readonly state: ReviewFocusState
  readonly effects: readonly ReviewFocusEffect[]
}

export const INITIAL_REVIEW_FOCUS_STATE: ReviewFocusState = Object.freeze({ status: "idle", attempt: 0 })

const CANCEL_REVEAL: ReviewFocusEffect = Object.freeze({ type: "cancel-reveal" })

const NO_EFFECTS: readonly ReviewFocusEffect[] = Object.freeze([])

export function transitionReviewFocus(state: ReviewFocusState, event: ReviewFocusEvent): ReviewFocusTransition {
  if (event.type === "focus.requested") {
    // A parent that sets the same target again, before it clears the request, does not restart the reveal.
    if (state.status !== "idle" && state.file === event.file && state.commentId === event.commentId)
      return { state, effects: NO_EFFECTS }

    const attempt = state.attempt + 1
    const cancel = state.status === "idle" ? [] : [CANCEL_REVEAL]
    const target = { attempt, file: event.file, commentId: event.commentId }

    if (!event.available)
      return {
        state: { status: "settled", ...target, outcome: "unavailable" },
        effects: [...cancel, { type: "acknowledge", attempt, deferred: true }],
      }

    return {
      state: { status: "revealing", ...target },
      effects: [
        ...cancel,
        { type: "open-comment", file: event.file, commentId: event.commentId },
        { type: "expand-file", file: event.file },
        { type: "reveal", attempt },
      ],
    }
  }

  if (event.type === "focus.cleared" || event.type === "disposed") {
    if (state.status === "idle") return { state, effects: NO_EFFECTS }

    return { state: { status: "idle", attempt: state.attempt }, effects: [CANCEL_REVEAL] }
  }

  if (state.status !== "revealing" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "reveal.succeeded")
    return {
      state: { ...state, status: "settled", outcome: "revealed" },
      effects: [
        CANCEL_REVEAL,
        // The comment may have arrived after the request, so open it again now that it rendered.
        { type: "open-comment", file: state.file, commentId: state.commentId },
        { type: "acknowledge", attempt: state.attempt, deferred: false },
      ],
    }

  return {
    state: { ...state, status: "settled", outcome: "timeout" },
    effects: [CANCEL_REVEAL, { type: "acknowledge", attempt: state.attempt, deferred: false }],
  }
}

/** The file a reveal keeps mounted while it waits for the comment to render. */
export function reviewFocusPinnedFile(state: ReviewFocusState) {
  return state.status === "revealing" ? state.file : undefined
}
