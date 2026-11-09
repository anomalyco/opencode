export type IndicatorBox = {
  readonly x: number
  readonly width: number
}

/**
 * The pill behind the selected segment. It is `placed` only while the selected segment has a measurable box, so a
 * selection that changes while the control is hidden (`display: none`) jumps to its segment once it shows instead
 * of springing from the previous segment's stale position.
 */
export type SegmentedIndicatorState =
  | { readonly status: "hidden" }
  | { readonly status: "placed"; readonly value: string; readonly box: IndicatorBox }
  | { readonly status: "disposed" }

export type SegmentedIndicatorEvent =
  | {
      readonly type: "measured"
      readonly value: string | null
      readonly box: IndicatorBox | null
      readonly reducedMotion: boolean
    }
  | { readonly type: "disposed" }

export type SegmentedIndicatorEffect =
  | { readonly type: "jump"; readonly box: IndicatorBox }
  | { readonly type: "animate"; readonly box: IndicatorBox }
  | { readonly type: "stop" }

export type SegmentedIndicatorTransition = {
  readonly state: SegmentedIndicatorState
  readonly effect: SegmentedIndicatorEffect | null
}

export const HIDDEN_INDICATOR: SegmentedIndicatorState = Object.freeze({ status: "hidden" })

const DISPOSED_INDICATOR: SegmentedIndicatorState = Object.freeze({ status: "disposed" })

const STOP: SegmentedIndicatorEffect = Object.freeze({ type: "stop" })

export function transitionSegmentedIndicator(
  state: SegmentedIndicatorState,
  event: SegmentedIndicatorEvent,
): SegmentedIndicatorTransition {
  if (state.status === "disposed") return { state, effect: null }

  if (event.type === "disposed") {
    return { state: DISPOSED_INDICATOR, effect: state.status === "placed" ? STOP : null }
  }

  if (event.value === null || event.box === null || event.box.width <= 0) {
    if (state.status === "hidden") return { state, effect: null }

    return { state: HIDDEN_INDICATOR, effect: STOP }
  }

  const next = { status: "placed", value: event.value, box: event.box } as const

  if (state.status === "hidden") return { state: next, effect: { type: "jump", box: event.box } }

  if (state.value === event.value) {
    if (state.box.x === event.box.x && state.box.width === event.box.width) return { state, effect: null }

    return { state: next, effect: { type: "jump", box: event.box } }
  }

  return { state: next, effect: { type: event.reducedMotion ? "jump" : "animate", box: event.box } }
}

export function selectIndicatorReady(state: SegmentedIndicatorState) {
  return state.status === "placed"
}
