export const ANIMATED_NUMBER_TRACK_LENGTH = 30

/** Added to the measured transition time before a roll or resize that never reported its end settles anyway. */
export const ANIMATED_NUMBER_FALLBACK_PAD_MS = 100

/**
 * `resizing` eases the width to `targetDigits` while extra leading places stay mounted to roll in or out. `attempt`
 * names each eased change, so a fallback timer from an earlier one cannot cut the current one short.
 */
export type AnimatedNumberState =
  | {
      readonly status: "static"
      readonly attempt: number
      readonly value: number
      readonly direction: 1 | -1
      readonly places: number
    }
  | {
      readonly status: "resizing"
      readonly attempt: number
      readonly value: number
      readonly direction: 1 | -1
      readonly places: number
      readonly targetDigits: number
    }
  | { readonly status: "disposed" }

/** `canAnimate` is false while detached or under reduced motion, where no transition runs to report its end. */
export type AnimatedNumberEvent =
  | { readonly type: "value.changed"; readonly value: number; readonly canAnimate: boolean }
  | { readonly type: "resize.ended" }
  | { readonly type: "resize.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type AnimatedDigitState =
  | { readonly status: "static"; readonly attempt: number; readonly digit: number; readonly step: number }
  | { readonly status: "rolling"; readonly attempt: number; readonly digit: number; readonly step: number }
  | { readonly status: "disposed" }

export type AnimatedDigitEvent =
  | { readonly type: "digit.changed"; readonly digit: number; readonly direction: 1 | -1; readonly canAnimate: boolean }
  | { readonly type: "roll.ended" }
  | { readonly type: "roll.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

/** `watch` arms the fallback for an eased change; `clear` drops it once the change has settled. */
export type AnimatedNumberEffect = { readonly type: "watch"; readonly attempt: number } | { readonly type: "clear" }

export type AnimatedNumberTransition<State> = {
  readonly state: State
  readonly effects: readonly AnimatedNumberEffect[]
}

const NONE: readonly AnimatedNumberEffect[] = Object.freeze([])

const CLEAR: readonly AnimatedNumberEffect[] = Object.freeze([Object.freeze({ type: "clear" })])

const DISPOSED = Object.freeze({ status: "disposed" as const })

export function createAnimatedNumberState(value: number): AnimatedNumberState {
  return { status: "static", attempt: 0, value, direction: 1, places: digits(value) + 1 }
}

export function transitionAnimatedNumber(
  state: AnimatedNumberState,
  event: AnimatedNumberEvent,
): AnimatedNumberTransition<AnimatedNumberState> {
  if (state.status === "disposed") return { state, effects: NONE }

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED, effects: state.status === "resizing" ? CLEAR : NONE }
    case "value.changed": {
      if (event.value === state.value) return { state, effects: NONE }
      const direction = event.value > state.value ? 1 : -1
      const count = digits(event.value)

      if (!event.canAnimate)
        return {
          state: { status: "static", attempt: state.attempt, value: event.value, direction, places: count + 1 },
          effects: state.status === "resizing" ? CLEAR : NONE,
        }

      // Only a change to the digit count eases the width, so a late font swap or zoom never animates it.
      if (count === (state.status === "resizing" ? state.targetDigits : digits(state.value)))
        return { state: { ...state, value: event.value, direction }, effects: NONE }

      const attempt = state.attempt + 1

      return {
        state: {
          status: "resizing",
          attempt,
          value: event.value,
          direction,
          places: Math.max(state.places, count + 1),
          targetDigits: count,
        },
        effects: [{ type: "watch", attempt }],
      }
    }

    case "resize.ended":
      return settleNumber(state)
    case "resize.timed-out":
      if (state.status !== "resizing" || event.attempt !== state.attempt) return { state, effects: NONE }

      return settleNumber(state)
  }
}

export function createAnimatedDigitState(digit: number): AnimatedDigitState {
  return { status: "static", attempt: 0, digit, step: digit + 10 }
}

export function transitionAnimatedDigit(
  state: AnimatedDigitState,
  event: AnimatedDigitEvent,
): AnimatedNumberTransition<AnimatedDigitState> {
  if (state.status === "disposed") return { state, effects: NONE }

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED, effects: state.status === "rolling" ? CLEAR : NONE }
    case "digit.changed": {
      const delta = spin(state.digit, event.digit, event.direction)

      // An unchanged digit keeps any roll it is in the middle of.
      if (!delta) return { state, effects: NONE }
      const target = state.step + delta

      // Rapid changes can run off the track, so they settle at once like a digit that cannot animate.
      if (!event.canAnimate || target < 0 || target >= ANIMATED_NUMBER_TRACK_LENGTH)
        return {
          state: { status: "static", attempt: state.attempt, digit: event.digit, step: event.digit + 10 },
          effects: state.status === "rolling" ? CLEAR : NONE,
        }

      const attempt = state.attempt + 1

      return {
        state: { status: "rolling", attempt, digit: event.digit, step: target },
        effects: [{ type: "watch", attempt }],
      }
    }

    case "roll.ended":
      return settleDigit(state)
    case "roll.timed-out":
      if (state.status !== "rolling" || event.attempt !== state.attempt) return { state, effects: NONE }

      return settleDigit(state)
  }
}

export function selectAnimatedNumberValue(state: AnimatedNumberState) {
  return state.status === "disposed" ? 0 : state.value
}

export function selectAnimatedNumberDirection(state: AnimatedNumberState) {
  return state.status === "disposed" ? 1 : state.direction
}

export function selectAnimatedNumberPlaces(state: AnimatedNumberState) {
  return state.status === "disposed" ? 1 : state.places
}

export function selectAnimatedNumberResizing(state: AnimatedNumberState) {
  return state.status === "resizing"
}

export function selectAnimatedDigitRolling(state: AnimatedDigitState) {
  return state.status === "rolling"
}

export function selectAnimatedDigitStep(state: AnimatedDigitState) {
  return state.status === "disposed" ? 10 : state.step
}

function settleNumber(state: Exclude<AnimatedNumberState, { status: "disposed" }>) {
  if (state.status !== "resizing") return { state, effects: NONE }

  return {
    state: {
      status: "static" as const,
      attempt: state.attempt,
      value: state.value,
      direction: state.direction,
      places: state.targetDigits + 1,
    },
    effects: CLEAR,
  }
}

function settleDigit(state: Exclude<AnimatedDigitState, { status: "disposed" }>) {
  if (state.status !== "rolling") return { state, effects: NONE }

  return {
    state: { status: "static" as const, attempt: state.attempt, digit: state.digit, step: state.digit + 10 },
    effects: CLEAR,
  }
}

function digits(value: number) {
  return String(value).length
}

function spin(from: number, to: number, direction: 1 | -1) {
  if (from === to) return 0

  if (direction > 0) return (to - from + 10) % 10

  return -((from - to + 10) % 10)
}
