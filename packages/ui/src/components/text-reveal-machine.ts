/** Fonts that never settle must not keep the reveal from animating. */
export const TEXT_REVEAL_READY_TIMEOUT_MS = 1_000

/**
 * `measuring` waits for fonts and one painted frame before transitions turn on, so the first text never animates in.
 * It only moves forward, so its results match on the phase. `swapping` holds a replaced text in place for one frame,
 * then the wipe runs. `leaving` is always text that was on screen, so text replaced within one frame never wipes out.
 */
export type TextRevealState =
  | { readonly status: "measuring"; readonly current: string | undefined; readonly widthPx: number }
  | {
      readonly status: "idle"
      readonly issued: number
      readonly current: string | undefined
      readonly leaving: string | undefined
      readonly widthPx: number
    }
  | {
      readonly status: "swapping"
      readonly attempt: number
      readonly current: string | undefined
      readonly leaving: string | undefined
      readonly widthPx: number
    }
  | { readonly status: "disposed" }

type Measured = { readonly widthPx: number; readonly growOnly: boolean }

export type TextRevealEvent =
  | { readonly type: "text.changed"; readonly text: string | undefined }
  | ({ readonly type: "width.measured" } & Measured)
  | ({ readonly type: "fonts.settled" } & Measured)
  | ({ readonly type: "ready.settled" } & Measured)
  | ({ readonly type: "ready.timed-out" } & Measured)
  | ({ readonly type: "swap.settled"; readonly attempt: number } & Measured)
  | { readonly type: "disposed" }

export type TextRevealEffect =
  | { readonly type: "measure.entering" }
  | { readonly type: "ready.frame" }
  | { readonly type: "swap.frame"; readonly attempt: number }
  | { readonly type: "cancel.frame" }
  | { readonly type: "cancel.ready-timer" }

export type TextRevealTransition = {
  readonly state: TextRevealState
  readonly effects: readonly TextRevealEffect[]
}

const NO_EFFECTS: readonly TextRevealEffect[] = Object.freeze([])

const MEASURE: TextRevealEffect = Object.freeze({ type: "measure.entering" })

const READY_FRAME: TextRevealEffect = Object.freeze({ type: "ready.frame" })

const CANCEL_FRAME: TextRevealEffect = Object.freeze({ type: "cancel.frame" })

const CANCEL_READY_TIMER: TextRevealEffect = Object.freeze({ type: "cancel.ready-timer" })

const DISPOSED: TextRevealState = Object.freeze({ status: "disposed" })

export function createTextRevealState(text: string | undefined): TextRevealState {
  return { status: "measuring", current: text, widthPx: 0 }
}

export function transitionTextReveal(state: TextRevealState, event: TextRevealEvent): TextRevealTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") {
    if (state.status === "measuring") return { state: DISPOSED, effects: [CANCEL_FRAME, CANCEL_READY_TIMER] }

    return { state: DISPOSED, effects: state.status === "swapping" ? [CANCEL_FRAME] : NO_EFFECTS }
  }

  if (event.type === "text.changed") return changeText(state, event.text)

  if (event.type === "width.measured") {
    const widthPx = widen(state.widthPx, event)

    return { state: widthPx === state.widthPx ? state : { ...state, widthPx }, effects: NO_EFFECTS }
  }

  if (state.status === "measuring" && event.type === "fonts.settled") {
    return { state: { ...state, widthPx: widen(state.widthPx, event) }, effects: [READY_FRAME] }
  }

  if (state.status === "measuring" && (event.type === "ready.settled" || event.type === "ready.timed-out")) {
    return {
      state: {
        status: "idle",
        issued: 0,
        current: state.current,
        leaving: undefined,
        widthPx: widen(state.widthPx, event),
      },
      effects: [CANCEL_FRAME, CANCEL_READY_TIMER],
    }
  }

  if (state.status === "swapping" && event.type === "swap.settled" && event.attempt === state.attempt) {
    return {
      state: {
        status: "idle",
        issued: state.attempt,
        current: state.current,
        leaving: state.leaving,
        widthPx: widen(state.widthPx, event),
      },
      effects: NO_EFFECTS,
    }
  }

  return { state, effects: NO_EFFECTS }
}

/** Transitions turn on once the first text has painted. */
export function selectTextRevealReady(state: TextRevealState) {
  return state.status === "idle" || state.status === "swapping"
}

export function selectTextRevealSwapping(state: TextRevealState) {
  return state.status === "swapping"
}

export function selectTextRevealEntering(state: TextRevealState) {
  return (state.status === "disposed" ? undefined : state.current) ?? "\u00A0"
}

export function selectTextRevealLeaving(state: TextRevealState) {
  return (state.status === "idle" || state.status === "swapping" ? state.leaving : undefined) ?? "\u00A0"
}

export function selectTextRevealTrackWidth(state: TextRevealState, truncate: boolean | undefined) {
  if (truncate) return "100%"

  return state.status !== "disposed" && state.widthPx > 0 ? `${state.widthPx}px` : "auto"
}

function changeText(
  state: Exclude<TextRevealState, { status: "disposed" }>,
  text: string | undefined,
): TextRevealTransition {
  if (text === state.current) return { state, effects: NO_EFFECTS }

  // Before the first paint nothing is on screen to wipe out, so the new text just replaces the old.
  if (state.status === "measuring") return { state: { ...state, current: text }, effects: [MEASURE] }

  if (state.status === "idle" && state.current !== undefined && text?.startsWith(state.current)) {
    return { state: { ...state, current: text }, effects: [MEASURE] }
  }

  // Changing back to the text still on screen cancels the swap that never painted.
  if (state.status === "swapping" && text === state.leaving) {
    return {
      state: { status: "idle", issued: state.attempt, current: text, leaving: undefined, widthPx: state.widthPx },
      effects: [CANCEL_FRAME, MEASURE],
    }
  }

  if (state.status === "swapping") {
    const attempt = state.attempt + 1

    return {
      state: { ...state, attempt, current: text },
      effects: [CANCEL_FRAME, { type: "swap.frame", attempt }],
    }
  }

  const attempt = state.issued + 1

  return {
    state: { status: "swapping", attempt, current: text, leaving: state.current, widthPx: state.widthPx },
    effects: [{ type: "swap.frame", attempt }],
  }
}

function widen(prev: number, measured: Measured) {
  if (measured.widthPx <= 0) return prev

  if (measured.growOnly && prev > 0 && measured.widthPx <= prev) return prev

  return measured.widthPx
}
