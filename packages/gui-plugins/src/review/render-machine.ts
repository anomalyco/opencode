export type ReviewRenderState =
  /** The model's first visit: the review waits one paint, so the session paints first. */
  | { readonly status: "initial-deferring"; readonly visitID: number; readonly attempt: number }
  /**
   * A later visit after an earlier one painted. The wide panel stays mounted, so its diff and tree neither tear down
   * nor flicker on a session switch (#35074); the narrow review waits one paint before it mounts the new list.
   */
  | { readonly status: "visit-deferring"; readonly visitID: number; readonly attempt: number }
  /** The visit's deferral frame passed; both reviews render. */
  | { readonly status: "ready"; readonly visitID: number; readonly attempt: number }
  | { readonly status: "disposed"; readonly attempt: number }

export type ReviewRenderEvent =
  /** The model's routed session visit, numbered by the model. */
  | { readonly type: "visit.synced"; readonly visitID: number }
  /** The frame scheduled for `attempt` painted. */
  | { readonly type: "frame.settled"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ReviewRenderEffect =
  | { readonly type: "frame.schedule"; readonly attempt: number }
  | { readonly type: "frame.cancel" }

export type ReviewRenderTransition = {
  readonly state: ReviewRenderState
  readonly effects: readonly ReviewRenderEffect[]
}

export const INITIAL_REVIEW_RENDER_STATE: ReviewRenderState = { status: "initial-deferring", visitID: 0, attempt: 0 }

const NONE: readonly ReviewRenderEffect[] = []

const CANCEL: ReviewRenderEffect = { type: "frame.cancel" }

export function transitionReviewRender(state: ReviewRenderState, event: ReviewRenderEvent): ReviewRenderTransition {
  if (state.status === "disposed") return unchanged(state)
  const scheduled = state.status !== "ready" && state.attempt > 0

  if (event.type === "disposed")
    return { state: { status: "disposed", attempt: state.attempt + 1 }, effects: scheduled ? [CANCEL] : NONE }

  if (event.type === "visit.synced") {
    if (event.visitID === state.visitID) return unchanged(state)
    const attempt = state.attempt + 1
    const schedule: ReviewRenderEffect = { type: "frame.schedule", attempt }

    return {
      state: {
        status: state.status === "initial-deferring" ? "initial-deferring" : "visit-deferring",
        visitID: event.visitID,
        attempt,
      },
      effects: scheduled ? [CANCEL, schedule] : [schedule],
    }
  }

  if (state.status === "ready" || event.attempt !== state.attempt) return unchanged(state)

  return { state: { status: "ready", visitID: state.visitID, attempt: state.attempt }, effects: NONE }
}

/** The wide panel mounts after the first visit's paint and then stays mounted across visits. */
export function reviewPanelReady(state: ReviewRenderState) {
  return state.status === "ready" || state.status === "visit-deferring"
}

/** The narrow review mounts one paint after each visit. */
export function reviewMobileReady(state: ReviewRenderState) {
  return state.status === "ready"
}

function unchanged(state: ReviewRenderState): ReviewRenderTransition {
  return { state, effects: NONE }
}
