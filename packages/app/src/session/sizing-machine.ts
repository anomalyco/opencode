export const SIZING_SETTLE_MS = 120

// Whether a pane is being resized, so panes skip their size animations. A held pointer keeps it sizing however long
// the drag pauses; a resize without one (a stray move after the button came up elsewhere) settles after a quiet spell.
export type SizingState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "dragging"; readonly attempt: number }
  | { readonly status: "settling"; readonly attempt: number }

export type SizingEvent =
  | { readonly type: "pointer.down" }
  | { readonly type: "pointer.up" }
  | { readonly type: "resize.touched" }
  | { readonly type: "settle.due"; readonly attempt: number }
  | { readonly type: "reset" }

export type SizingEffect =
  | { readonly type: "schedule-settle"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-settle" }

export type SizingTransition = {
  readonly state: SizingState
  readonly effects: readonly SizingEffect[]
}

const NONE: readonly SizingEffect[] = []

const CANCEL: readonly SizingEffect[] = [{ type: "cancel-settle" }]

export function createSizingState(): SizingState {
  return { status: "idle", attempt: 0 }
}

export function transitionSizing(state: SizingState, event: SizingEvent): SizingTransition {
  if (event.type === "pointer.down") {
    if (state.status === "dragging") return { state, effects: NONE }

    return {
      state: { status: "dragging", attempt: state.attempt },
      effects: state.status === "settling" ? CANCEL : NONE,
    }
  }

  if (event.type === "pointer.up") {
    if (state.status !== "dragging") return { state, effects: NONE }

    return { state: { status: "idle", attempt: state.attempt }, effects: NONE }
  }

  // Runs on every move of a drag, so a held pointer returns the same state and arms no timer.
  if (event.type === "resize.touched") {
    if (state.status === "dragging") return { state, effects: NONE }
    const attempt = state.attempt + 1

    return {
      state: { status: "settling", attempt },
      effects: [{ type: "schedule-settle", attempt, delayMs: SIZING_SETTLE_MS }],
    }
  }

  if (event.type === "settle.due") {
    if (state.status !== "settling" || state.attempt !== event.attempt) return { state, effects: NONE }

    return { state: { status: "idle", attempt: state.attempt }, effects: NONE }
  }

  if (state.status === "idle") return { state, effects: NONE }

  return { state: { status: "idle", attempt: state.attempt }, effects: state.status === "settling" ? CANCEL : NONE }
}

export function isSizingActive(state: SizingState) {
  return state.status !== "idle"
}
