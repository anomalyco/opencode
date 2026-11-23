import type { DurationOptions } from "@opencode/ui/motion"

/** Reduced motion trades the height for a short fade. */
export const SOURCES_FADE_CURVE: DurationOptions = Object.freeze({ duration: 0.15, bounce: 0 })

/**
 * A search step's results: the region springs its height open and closed, or fades in under reduced motion. The
 * spring itself belongs to the driver, which steps it each frame without dispatching and reports `settled` once it
 * rests. `reversed` means the flight turned around mid-way, so the spring keeps its position and velocity.
 */
export type SourcesExpandState =
  | { readonly status: "closed"; readonly attempt: number }
  | { readonly status: "open"; readonly attempt: number }
  | {
      readonly status: "opening" | "closing"
      readonly attempt: number
      readonly mode: "height" | "fade"
      readonly reversed: boolean
    }
  | { readonly status: "disposed" }

export type SourcesExpandEvent =
  | { readonly type: "toggle"; readonly expandable: boolean; readonly reduced: boolean }
  | { readonly type: "settled"; readonly attempt: number }
  | { readonly type: "detached"; readonly attempt: number }
  | { readonly type: "reduced" }
  | { readonly type: "collapse" }
  | { readonly type: "disposed" }

export const INITIAL_SOURCES_EXPAND_STATE: SourcesExpandState = Object.freeze({ status: "closed", attempt: 0 })

export const DISPOSED_SOURCES_EXPAND_STATE: SourcesExpandState = Object.freeze({ status: "disposed" })

export const REDUCED_SOURCES_EXPAND_EVENT: SourcesExpandEvent = Object.freeze({ type: "reduced" })

export const COLLAPSE_SOURCES_EXPAND_EVENT: SourcesExpandEvent = Object.freeze({ type: "collapse" })

export const DISPOSED_SOURCES_EXPAND_EVENT: SourcesExpandEvent = Object.freeze({ type: "disposed" })

type Moving = Extract<SourcesExpandState, { status: "opening" | "closing" }>

export function transitionSourcesExpand(state: SourcesExpandState, event: SourcesExpandEvent): SourcesExpandState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_SOURCES_EXPAND_STATE

  if (event.type === "toggle") return toggle(state, event)

  if (event.type === "collapse")
    return state.status === "closed" ? state : { status: "closed", attempt: state.attempt + 1 }

  if (state.status !== "opening" && state.status !== "closing") return state

  if (event.type === "reduced") return land(state)

  if (event.attempt !== state.attempt) return state

  // A spring at rest, or results that left the document and cannot be stepped: settle where the step was heading.
  return land(state)
}

export function isSourcesStepOpen(state: SourcesExpandState) {
  return state.status === "opening" || state.status === "open"
}

export function isSourcesStepMounted(state: SourcesExpandState) {
  return state.status === "opening" || state.status === "open" || state.status === "closing"
}

export function isSourcesStepMoving(state: SourcesExpandState): state is Moving {
  return state.status === "opening" || state.status === "closing"
}

function toggle(
  state: Exclude<SourcesExpandState, { status: "disposed" }>,
  event: Extract<SourcesExpandEvent, { type: "toggle" }>,
): SourcesExpandState {
  const attempt = state.attempt + 1

  if (state.status === "closed" || state.status === "closing") {
    if (!event.expandable) return state

    if (event.reduced) return { status: "opening", attempt, mode: "fade", reversed: false }

    return { status: "opening", attempt, mode: "height", reversed: state.status === "closing" }
  }

  if (event.reduced) return { status: "closed", attempt }

  // Closing mid-way through a height flight turns the same spring around; a fade has no height to reverse.
  return {
    status: "closing",
    attempt,
    mode: "height",
    reversed: state.status === "opening" && state.mode === "height",
  }
}

function land(state: Moving): SourcesExpandState {
  return { status: state.status === "opening" ? "open" : "closed", attempt: state.attempt }
}
