/**
 * The debug bar's FOCUS toggle. `changing` waits for main to apply `target`; main held `!target` before that call.
 * `desired` is the user's latest click, so a click while the call is in flight flips it, and the follow-up call starts
 * once this one settles. `attempt` fences call results; `idle` keeps the last one issued.
 */
export type FocusToggleState =
  | { readonly status: "idle"; readonly attempt: number; readonly enabled: boolean }
  | { readonly status: "changing"; readonly attempt: number; readonly target: boolean; readonly desired: boolean }
  | { readonly status: "disposed" }

export type FocusToggleEvent =
  | { readonly type: "toggle" }
  | { readonly type: "set.succeeded"; readonly attempt: number }
  | { readonly type: "set.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type FocusToggleEffect =
  | { readonly type: "set"; readonly attempt: number; readonly enabled: boolean }
  | { readonly type: "reset" }
  | { readonly type: "notify-failed" }

export type FocusToggleTransition = {
  readonly state: FocusToggleState
  readonly effects: readonly FocusToggleEffect[]
}

export const initialFocusToggleState: FocusToggleState = Object.freeze({ status: "idle", attempt: 0, enabled: false })

export function transitionFocusToggle(state: FocusToggleState, event: FocusToggleEvent): FocusToggleTransition {
  if (state.status === "disposed") return unchanged(state)

  switch (event.type) {
    case "toggle": {
      if (state.status === "idle") return start(state.attempt + 1, !state.enabled)

      return { state: { ...state, desired: !state.desired }, effects: [] }
    }

    case "set.succeeded": {
      if (state.status !== "changing" || state.attempt !== event.attempt) return unchanged(state)

      if (state.desired !== state.target) return start(state.attempt + 1, state.desired)

      return { state: { status: "idle", attempt: state.attempt, enabled: state.target }, effects: [] }
    }

    case "set.failed": {
      if (state.status !== "changing" || state.attempt !== event.attempt) return unchanged(state)

      return {
        state: { status: "idle", attempt: state.attempt, enabled: !state.target },
        // A user who already clicked back has what they asked for.
        effects: state.desired === state.target ? [{ type: "notify-failed" }] : [],
      }
    }

    case "disposed": {
      // Main may still turn force focus on for a call in flight, so a closing bar always asks to turn it off after.
      const on = state.status === "idle" ? state.enabled : state.target

      return { state: { status: "disposed" }, effects: on ? [{ type: "reset" }] : [] }
    }
  }
}

/** Whether the FOCUS cell shows on: the user's latest choice, ahead of main confirming it. */
export function isFocusToggleActive(state: FocusToggleState) {
  if (state.status === "changing") return state.desired

  if (state.status === "idle") return state.enabled

  return false
}

function start(attempt: number, enabled: boolean): FocusToggleTransition {
  return {
    state: { status: "changing", attempt, target: enabled, desired: enabled },
    effects: [{ type: "set", attempt, enabled }],
  }
}

function unchanged(state: FocusToggleState): FocusToggleTransition {
  return { state, effects: [] }
}
