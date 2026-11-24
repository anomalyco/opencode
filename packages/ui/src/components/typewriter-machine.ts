export const TYPEWRITER_INITIAL_DELAY_MS = 200

export const TYPEWRITER_LINGER_MS = 2_000

export type TypewriterCursor = "none" | "solid" | "blinking"

/**
 * `typing` shows the first `index` characters behind a solid cursor; `index` 0 is the pause before the first one.
 * `lingering` shows the whole text behind a blinking cursor, then `done` hides the cursor.
 */
export type TypewriterState =
  | { readonly status: "empty"; readonly attempts: number }
  | {
      readonly status: "typing"
      readonly attempt: number
      readonly text: string
      /** Code points, so a step never shows half of a surrogate pair. */
      readonly chars: readonly string[]
      readonly index: number
    }
  | { readonly status: "lingering"; readonly attempt: number; readonly text: string }
  | { readonly status: "done"; readonly attempts: number; readonly text: string }
  | { readonly status: "disposed" }

export type TypewriterEvent =
  | { readonly type: "sync"; readonly text: string | undefined; readonly reducedMotion: boolean }
  | { readonly type: "typing.step"; readonly attempt: number }
  | { readonly type: "linger.ended"; readonly attempt: number }
  | { readonly type: "disposed" }

export type TypewriterEffect =
  | { readonly type: "none" }
  | { readonly type: "clear" }
  | { readonly type: "schedule"; readonly kind: "initial" | "step" | "linger"; readonly attempt: number }

export type TypewriterTransition = {
  readonly state: TypewriterState
  readonly effect: TypewriterEffect
}

export const INITIAL_EMPTY_TYPEWRITER_STATE: TypewriterState = Object.freeze({ status: "empty", attempts: 0 })

export const DISPOSED_TYPEWRITER_STATE: TypewriterState = Object.freeze({ status: "disposed" })

export const DISPOSED_TYPEWRITER_EVENT: TypewriterEvent = Object.freeze({ type: "disposed" })

const NONE: TypewriterEffect = Object.freeze({ type: "none" })

const CLEAR: TypewriterEffect = Object.freeze({ type: "clear" })

/** Mostly quick keystrokes, with an occasional hesitation. `roll` and `jitter` are uniform in [0, 1). */
export function typingStepDelayMs(roll: number, jitter: number) {
  if (roll < 0.05) return 150 + jitter * 100

  if (roll < 0.15) return 80 + jitter * 60

  return 30 + jitter * 50
}

export function transitionTypewriter(state: TypewriterState, event: TypewriterEvent): TypewriterTransition {
  if (state.status === "disposed") return { state, effect: NONE }
  const timed = state.status === "typing" || state.status === "lingering"

  if (event.type === "disposed") return { state: DISPOSED_TYPEWRITER_STATE, effect: timed ? CLEAR : NONE }

  if (event.type === "sync") return sync(state, event)

  if (event.type === "typing.step") {
    if (state.status !== "typing" || event.attempt !== state.attempt) return { state, effect: NONE }

    if (state.index + 1 < state.chars.length)
      return {
        state: { ...state, index: state.index + 1 },
        effect: { type: "schedule", kind: "step", attempt: state.attempt },
      }

    return {
      state: { status: "lingering", attempt: state.attempt, text: state.text },
      effect: { type: "schedule", kind: "linger", attempt: state.attempt },
    }
  }

  if (state.status !== "lingering" || event.attempt !== state.attempt) return { state, effect: NONE }

  return { state: { status: "done", attempts: state.attempt, text: state.text }, effect: NONE }
}

function sync(
  state: Exclude<TypewriterState, { status: "disposed" }>,
  event: Extract<TypewriterEvent, { type: "sync" }>,
): TypewriterTransition {
  const timed = state.status === "typing" || state.status === "lingering"
  const attempts = timed ? state.attempt : state.attempts
  const text = event.text ?? ""

  if (text === "") {
    if (state.status === "empty") return { state, effect: NONE }

    return {
      state: attempts === 0 ? INITIAL_EMPTY_TYPEWRITER_STATE : { status: "empty", attempts },
      effect: timed ? CLEAR : NONE,
    }
  }

  // Reduced motion shows the whole text at once, without a cursor.
  if (event.reducedMotion) {
    if (state.status === "done" && state.text === text) return { state, effect: NONE }

    return { state: { status: "done", attempts, text }, effect: timed ? CLEAR : NONE }
  }

  if (state.status !== "empty" && state.text === text) return { state, effect: NONE }

  return {
    state: { status: "typing", attempt: attempts + 1, text, chars: Array.from(text), index: 0 },
    effect: { type: "schedule", kind: "initial", attempt: attempts + 1 },
  }
}

export function selectTypewriterDisplayed(state: TypewriterState) {
  if (state.status === "empty" || state.status === "disposed") return ""

  if (state.status === "typing") return state.chars.slice(0, state.index).join("")

  return state.text
}

export function selectTypewriterCursor(state: TypewriterState): TypewriterCursor {
  if (state.status === "typing") return "solid"

  if (state.status === "lingering") return "blinking"

  return "none"
}
