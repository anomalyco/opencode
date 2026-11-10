export const TAB_HINTS_DELAY_MS = 400

/** `pending` waits out the delay after the mod key went down alone; `shown` draws the numbers. */
export type TabHintsState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "pending"; readonly attempt: number }
  | { readonly status: "shown"; readonly attempt: number }

/**
 * `mod` is whether the platform's mod key (⌘ on Mac, Ctrl elsewhere) is held, `extra` whether any other modifier is.
 * `key.down` names the key that went down; `modifiers` reports the held state from a key release or a pointer event.
 */
export type TabHintsEvent =
  | {
      readonly type: "key.down"
      readonly key: "mod" | "digit" | "other"
      readonly mod: boolean
      readonly extra: boolean
    }
  | { readonly type: "modifiers"; readonly mod: boolean; readonly extra: boolean }
  | { readonly type: "delay.elapsed"; readonly attempt: number }
  | { readonly type: "window.left" }
  | { readonly type: "disposed" }

export type TabHintsEffect =
  | { readonly type: "delay.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "delay.clear" }

export type TabHintsTransition = {
  readonly state: TabHintsState
  readonly effects: readonly TabHintsEffect[]
}

export const INITIAL_TAB_HINTS_STATE: TabHintsState = Object.freeze({ status: "idle", attempt: 0 })

const NONE: readonly never[] = []

const CLEAR: readonly TabHintsEffect[] = [{ type: "delay.clear" }]

export function transitionTabHints(state: TabHintsState, event: TabHintsEvent): TabHintsTransition {
  if (event.type === "delay.elapsed") {
    if (state.status !== "pending" || state.attempt !== event.attempt) return unchanged(state)

    return { state: { status: "shown", attempt: state.attempt }, effects: NONE }
  }

  if (event.type === "window.left" || event.type === "disposed" || !event.mod || event.extra) return reset(state)

  if (event.type === "modifiers") return unchanged(state)

  if (event.key === "mod") {
    if (state.status !== "idle") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "pending", attempt },
      effects: [{ type: "delay.start", attempt, delayMs: TAB_HINTS_DELAY_MS }],
    }
  }

  // Once shown, the numbers stay while digits pick tabs; any other shortcut, or a digit pressed early, cancels them.
  if (event.key === "digit" && state.status === "shown") return unchanged(state)

  return reset(state)
}

export function selectTabHintsShown(state: TabHintsState) {
  return state.status === "shown"
}

function reset(state: TabHintsState): TabHintsTransition {
  if (state.status === "idle") return unchanged(state)

  return { state: { status: "idle", attempt: state.attempt }, effects: state.status === "pending" ? CLEAR : NONE }
}

function unchanged(state: TabHintsState): TabHintsTransition {
  return { state, effects: NONE }
}
