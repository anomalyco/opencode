import { Spring, type DurationOptions } from "@opencode/ui/motion"

/** Reduced motion trades the height for a short fade. */
export const SOURCES_FADE_CURVE: DurationOptions = Object.freeze({ duration: 0.15, bounce: 0 })

export type SourcesFlightMode = "height" | "fade"

type SourcesMoving = {
  readonly attempt: number
  readonly mode: SourcesFlightMode
  /** Height in px for `height`, opacity from 0 to 1 for `fade`. */
  readonly spring: Spring
  /** A flight from rest starts where the region measures; a reversed one keeps its spring's position and velocity. */
  readonly fromRest: boolean
  measured: boolean
  /** The value the last step reached, written in place each frame so a frame allocates nothing. */
  value: number
}

/** A search step's results: the region springs its height open and closed, or fades in under reduced motion. */
export type SourcesExpandState =
  | { readonly status: "closed"; readonly attempt: number }
  | { readonly status: "open"; readonly attempt: number }
  | ({ readonly status: "opening" } & SourcesMoving)
  | ({ readonly status: "closing" } & SourcesMoving)
  | { readonly status: "disposed" }

export type SourcesExpandEvent =
  | {
      readonly type: "toggle"
      readonly expandable: boolean
      readonly reduced: boolean
      readonly curve: DurationOptions
    }
  | { readonly type: "measured"; readonly attempt: number; readonly from: number; readonly to: number }
  // Mutable: the driver reuses one frame event for every frame.
  | { type: "frame"; attempt: number; dt: number }
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

  // Results that left the document cannot be measured or stepped: settle where the step was heading.
  if (event.type === "detached") return land(state)

  if (event.type === "measured") {
    if (state.measured) return state

    if (state.fromRest) state.spring.snap(event.from)
    state.spring.set(event.to)
    state.measured = true
    state.value = state.spring.value

    return state.spring.resting ? land(state) : state
  }

  if (!state.measured) return state
  const value = state.spring.step(event.dt)

  if (state.spring.resting) return land(state)
  state.value = Math.max(0, value)

  return state
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

    if (event.reduced) return fade(attempt)

    // Opening again mid-close keeps the spring's velocity and measures the new target.
    if (state.status === "closing" && state.mode === "height")
      return { ...flight(state, event.curve), status: "opening", measured: false }

    return height("opening", attempt, event.curve)
  }

  if (event.reduced) return { status: "closed", attempt }

  if (state.status === "opening" && state.mode === "height")
    return { ...flight(state, event.curve), status: "closing", measured: true, spring: state.spring.set(0) }

  return height("closing", attempt, event.curve)
}

function flight(state: Moving, curve: DurationOptions) {
  state.spring.omega = (2 * Math.PI) / curve.duration
  state.spring.zeta = 1 - curve.bounce

  return {
    attempt: state.attempt,
    mode: "height" as const,
    spring: state.spring,
    fromRest: false,
    value: state.value,
  }
}

function height(status: "opening" | "closing", attempt: number, curve: DurationOptions): SourcesExpandState {
  return {
    status,
    attempt,
    mode: "height",
    spring: Spring.fromDuration(0, curve),
    fromRest: true,
    measured: false,
    value: 0,
  }
}

function fade(attempt: number): SourcesExpandState {
  return {
    status: "opening",
    attempt,
    mode: "fade",
    spring: Spring.fromDuration(0, SOURCES_FADE_CURVE).set(1),
    fromRest: true,
    measured: true,
    value: 0,
  }
}

function land(state: Moving): SourcesExpandState {
  return { status: state.status === "opening" ? "open" : "closed", attempt: state.attempt }
}
