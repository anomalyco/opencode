export const SCROLL_IDLE_MS = 800

export type ScrollAxis = "vertical" | "horizontal"

/**
 * `scrolling` shows the thumb until `SCROLL_IDLE_MS` after the last scroll. `dragging` holds the pointer on one thumb;
 * `scrolled` records a scroll during the drag, so its release keeps the thumb up for the idle delay. A thumb exists
 * only while its axis overflows, so losing that overflow ends a drag on it.
 */
export type ScrollThumbState =
  | {
      readonly status: "idle" | "scrolling"
      readonly hovered: boolean
      readonly verticalOverflow: boolean
      readonly horizontalOverflow: boolean
    }
  | {
      readonly status: "dragging"
      readonly axis: ScrollAxis
      readonly pointerId: number
      readonly grabOffset: number
      readonly rtl: boolean
      readonly hovered: boolean
      readonly scrolled: boolean
      readonly verticalOverflow: boolean
      readonly horizontalOverflow: boolean
    }
  | { readonly status: "disposed" }

export type ScrollThumbEvent =
  | { readonly type: "hover.changed"; readonly hovered: boolean }
  | { readonly type: "scrolled" }
  | { readonly type: "idle.elapsed" }
  | { readonly type: "overflow.changed"; readonly vertical: boolean; readonly horizontal: boolean }
  | {
      readonly type: "drag.started"
      readonly axis: ScrollAxis
      readonly pointerId: number
      readonly grabOffset: number
      readonly rtl: boolean
    }
  | { readonly type: "drag.ended"; readonly pointerId: number }
  | { readonly type: "disposed" }

export type ScrollThumbEffect = "reset-idle-timer" | "clear-idle-timer" | "release-capture"

export type ScrollThumbTransition = {
  readonly state: ScrollThumbState
  readonly effects: readonly ScrollThumbEffect[]
}

type Resting = Extract<ScrollThumbState, { readonly status: "idle" | "scrolling" }>

type Dragging = Extract<ScrollThumbState, { readonly status: "dragging" }>

// Scroll, wheel and resize fire every frame. Every resting state and the common transitions are prebuilt, so those
// events allocate nothing.
const RESTING = (["idle", "scrolling"] as const).flatMap((status) =>
  [false, true].flatMap((hovered) =>
    [false, true].flatMap((verticalOverflow) =>
      [false, true].map(
        (horizontalOverflow): Resting => Object.freeze({ status, hovered, verticalOverflow, horizontalOverflow }),
      ),
    ),
  ),
)

const DISPOSED: ScrollThumbState = Object.freeze({ status: "disposed" })

export const INITIAL_SCROLL_THUMB_STATE: ScrollThumbState = resting("idle", false, false, false)

export const SCROLLED: ScrollThumbEvent = Object.freeze({ type: "scrolled" })

export const SCROLL_IDLE_ELAPSED: ScrollThumbEvent = Object.freeze({ type: "idle.elapsed" })

export const HOVER_ENTERED: ScrollThumbEvent = Object.freeze({ type: "hover.changed", hovered: true })

export const HOVER_LEFT: ScrollThumbEvent = Object.freeze({ type: "hover.changed", hovered: false })

export const SCROLL_THUMB_DISPOSED: ScrollThumbEvent = Object.freeze({ type: "disposed" })

const OVERFLOW = [false, true].flatMap((vertical) =>
  [false, true].map(
    (horizontal): ScrollThumbEvent => Object.freeze({ type: "overflow.changed", vertical, horizontal }),
  ),
)

const NONE: readonly ScrollThumbEffect[] = Object.freeze([])

const RESET: readonly ScrollThumbEffect[] = Object.freeze(["reset-idle-timer"])

const CLEAR: readonly ScrollThumbEffect[] = Object.freeze(["clear-idle-timer"])

const RELEASE: readonly ScrollThumbEffect[] = Object.freeze(["release-capture"])

const RELEASE_AND_RESET: readonly ScrollThumbEffect[] = Object.freeze(["release-capture", "reset-idle-timer"])

const RELEASE_AND_CLEAR: readonly ScrollThumbEffect[] = Object.freeze(["release-capture", "clear-idle-timer"])

// A drag's state is built per drag, so its no-op transition is cached on first use; pointer moves then allocate nothing.
const KEEP = new WeakMap<ScrollThumbState, ScrollThumbTransition>(
  [...RESTING, DISPOSED].map((state) => [state, Object.freeze({ state, effects: NONE })]),
)

const RESTART = new Map<ScrollThumbState, ScrollThumbTransition>(
  RESTING.map((state) => [state, Object.freeze({ state, effects: RESET })]),
)

export function overflowChanged(vertical: boolean, horizontal: boolean) {
  return OVERFLOW[(vertical ? 2 : 0) + (horizontal ? 1 : 0)]
}

export function transitionScrollThumb(state: ScrollThumbState, event: ScrollThumbEvent): ScrollThumbTransition {
  if (state.status === "disposed") return to(state, NONE)

  if (event.type === "disposed")
    return to(DISPOSED, state.status === "dragging" ? RELEASE_AND_CLEAR : state.status === "scrolling" ? CLEAR : NONE)

  if (state.status === "dragging") return transitionDragging(state, event)

  return transitionResting(state, event)
}

export function selectShowVerticalThumb(state: ScrollThumbState) {
  return state.status !== "disposed" && state.verticalOverflow
}

export function selectShowHorizontalThumb(state: ScrollThumbState) {
  return state.status !== "disposed" && state.horizontalOverflow
}

/** Scroll-only reveal: a drag shows the thumb through `selectDraggingAxis` instead. */
export function selectThumbScrolling(state: ScrollThumbState) {
  return state.status === "scrolling"
}

export function selectDraggingAxis(state: ScrollThumbState) {
  return state.status === "dragging" ? state.axis : undefined
}

/** `hoverReveals` is the `hover` visibility mode; in `scroll` mode only scrolling and dragging show the thumb. */
export function selectThumbVisible(state: ScrollThumbState, hoverReveals: boolean) {
  if (state.status === "dragging" || state.status === "scrolling") return true

  return state.status === "idle" && hoverReveals && state.hovered
}

function transitionResting(
  state: Resting,
  event: Exclude<ScrollThumbEvent, { type: "disposed" }>,
): ScrollThumbTransition {
  switch (event.type) {
    case "hover.changed":
      return to(resting(state.status, event.hovered, state.verticalOverflow, state.horizontalOverflow), NONE)
    case "scrolled":
      if (!state.verticalOverflow && !state.horizontalOverflow) return to(state, NONE)

      return to(resting("scrolling", state.hovered, state.verticalOverflow, state.horizontalOverflow), RESET)
    case "idle.elapsed":
      if (state.status !== "scrolling") return to(state, NONE)

      return to(resting("idle", state.hovered, state.verticalOverflow, state.horizontalOverflow), NONE)
    case "overflow.changed":
      if (state.status === "scrolling" && !event.vertical && !event.horizontal)
        return to(resting("idle", state.hovered, false, false), CLEAR)

      return to(resting(state.status, state.hovered, event.vertical, event.horizontal), NONE)
    case "drag.started":
      if (!(event.axis === "vertical" ? state.verticalOverflow : state.horizontalOverflow)) return to(state, NONE)

      return {
        state: {
          status: "dragging",
          axis: event.axis,
          pointerId: event.pointerId,
          grabOffset: event.grabOffset,
          rtl: event.rtl,
          hovered: state.hovered,
          scrolled: state.status === "scrolling",
          verticalOverflow: state.verticalOverflow,
          horizontalOverflow: state.horizontalOverflow,
        },
        effects: state.status === "scrolling" ? CLEAR : NONE,
      }
    case "drag.ended":
      return to(state, NONE)
  }
}

function transitionDragging(
  state: Dragging,
  event: Exclude<ScrollThumbEvent, { type: "disposed" }>,
): ScrollThumbTransition {
  switch (event.type) {
    case "hover.changed":
      if (event.hovered === state.hovered) return to(state, NONE)

      return to({ ...state, hovered: event.hovered }, NONE)
    case "scrolled":
      if (state.scrolled) return to(state, NONE)

      return to({ ...state, scrolled: true }, NONE)
    case "overflow.changed":
      // The thumb unmounts with its overflow, and a removed element drops pointer capture without a `pointerup`.
      if (!(state.axis === "vertical" ? event.vertical : event.horizontal))
        return release(state, event.vertical, event.horizontal)

      if (event.vertical === state.verticalOverflow && event.horizontal === state.horizontalOverflow)
        return to(state, NONE)

      return to({ ...state, verticalOverflow: event.vertical, horizontalOverflow: event.horizontal }, NONE)
    case "drag.ended":
      if (event.pointerId !== state.pointerId) return to(state, NONE)

      return release(state, state.verticalOverflow, state.horizontalOverflow)
    case "idle.elapsed":
    case "drag.started":
      return to(state, NONE)
  }
}

function release(state: Dragging, vertical: boolean, horizontal: boolean) {
  if (state.scrolled && (vertical || horizontal))
    return to(resting("scrolling", state.hovered, vertical, horizontal), RELEASE_AND_RESET)

  return to(resting("idle", state.hovered, vertical, horizontal), RELEASE)
}

function to(state: ScrollThumbState, effects: readonly ScrollThumbEffect[]): ScrollThumbTransition {
  if (effects === NONE) return KEEP.get(state) ?? keep(state)

  return (effects === RESET ? RESTART.get(state) : undefined) ?? { state, effects }
}

function keep(state: ScrollThumbState) {
  const transition = Object.freeze({ state, effects: NONE })
  KEEP.set(state, transition)

  return transition
}

function resting(status: Resting["status"], hovered: boolean, vertical: boolean, horizontal: boolean) {
  return RESTING[(status === "scrolling" ? 8 : 0) + (hovered ? 4 : 0) + (vertical ? 2 : 0) + (horizontal ? 1 : 0)]
}
