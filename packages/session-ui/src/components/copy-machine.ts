export const COPY_FEEDBACK_MS = 2_000

/**
 * A copy button's feedback. `copying` keeps the checkmark of a click inside the feedback window while the next write
 * settles, and `attempt` lets only the latest write and its own reset timer move the button.
 */
export type CopyFeedbackState =
  | { readonly status: "idle"; readonly attempts: number }
  | { readonly status: "copying"; readonly attempt: number; readonly copied: boolean }
  | { readonly status: "copied"; readonly attempt: number }

export type CopyFeedbackEvent =
  | { readonly type: "copy.requested"; readonly text: string }
  | { readonly type: "copy.succeeded"; readonly attempt: number }
  | { readonly type: "copy.failed"; readonly attempt: number }
  | { readonly type: "reset.due"; readonly attempt: number }
  | { readonly type: "disposed" }

export type CopyFeedbackEffect =
  | { readonly type: "write"; readonly attempt: number; readonly text: string }
  | { readonly type: "schedule-reset"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "clear-reset" }

export type CopyFeedbackTransition = {
  readonly state: CopyFeedbackState
  readonly effects: readonly CopyFeedbackEffect[]
}

export const INITIAL_COPY_FEEDBACK_STATE: CopyFeedbackState = Object.freeze({ status: "idle", attempts: 0 })

const NO_EFFECTS: readonly CopyFeedbackEffect[] = Object.freeze([])

const CLEAR_RESET: CopyFeedbackEffect = Object.freeze({ type: "clear-reset" })

export function transitionCopyFeedback(state: CopyFeedbackState, event: CopyFeedbackEvent): CopyFeedbackTransition {
  if (event.type === "copy.requested") {
    if (!event.text) return { state, effects: NO_EFFECTS }
    const attempt = (state.status === "idle" ? state.attempts : state.attempt) + 1
    const write = { type: "write", attempt, text: event.text } as const

    if (state.status === "copied")
      return { state: { status: "copying", attempt, copied: true }, effects: [CLEAR_RESET, write] }

    return {
      state: { status: "copying", attempt, copied: state.status === "copying" && state.copied },
      effects: [write],
    }
  }

  if (state.status === "idle") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return {
      state: { status: "idle", attempts: state.attempt },
      effects: state.status === "copied" ? [CLEAR_RESET] : NO_EFFECTS,
    }

  if (event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "copy.succeeded") {
    if (state.status !== "copying") return { state, effects: NO_EFFECTS }

    return {
      state: { status: "copied", attempt: state.attempt },
      effects: [{ type: "schedule-reset", attempt: state.attempt, delayMs: COPY_FEEDBACK_MS }],
    }
  }

  if (event.type === "copy.failed" && state.status !== "copying") return { state, effects: NO_EFFECTS }

  if (event.type === "reset.due" && state.status !== "copied") return { state, effects: NO_EFFECTS }

  return { state: { status: "idle", attempts: state.attempt }, effects: NO_EFFECTS }
}

export function viewCopyFeedback(state: CopyFeedbackState) {
  return { copied: state.status === "copied" || (state.status === "copying" && state.copied) }
}
