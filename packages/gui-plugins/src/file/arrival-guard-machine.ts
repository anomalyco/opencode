/**
 * How long a file tab that an agent selected takes no input once the person can see it. A click or key press that was
 * on its way to what the pane showed before lands on nothing; the browser pane holds its pages back for as long.
 */
export const ARRIVAL_GUARD_MS = 500

/**
 * The file tab another plugin selected for an agent, in front of whatever the pane showed. `waiting` until the pane
 * shows the tab to the person, then `timing` for `ARRIVAL_GUARD_MS`. `token` tells one arrival's timer from the next.
 */
export type ArrivalGuardState =
  | { readonly status: "none"; readonly issued: number }
  | { readonly status: "waiting" | "timing"; readonly issued: number; readonly key: string; readonly token: number }

export type ArrivalGuardEvent =
  /** An agent's request selected the tab `key`, which the pane did not show. */
  | { readonly type: "arrived"; readonly key: string }
  /** The pane shows the tab `key` to the person. */
  | { readonly type: "shown"; readonly key: string }
  | { readonly type: "elapsed"; readonly token: number }
  /** The person selected a tab themselves, or closed this one: nothing is held for their own action. */
  | { readonly type: "left" }

/** Starts the delay after which `elapsed` ends the guard. */
export type ArrivalGuardEffect = { readonly type: "expire"; readonly token: number }

export type ArrivalGuardTransition = {
  readonly state: ArrivalGuardState
  readonly effects: readonly ArrivalGuardEffect[]
}

export function createArrivalGuardState(): ArrivalGuardState {
  return { status: "none", issued: 0 }
}

export function transitionArrivalGuard(state: ArrivalGuardState, event: ArrivalGuardEvent): ArrivalGuardTransition {
  if (event.type === "arrived") {
    const token = state.issued + 1

    return { state: { status: "waiting", issued: token, key: event.key, token }, effects: [] }
  }

  if (state.status === "none") return { state, effects: [] }

  if (event.type === "shown") {
    if (state.status !== "waiting" || state.key !== event.key) return { state, effects: [] }

    return { state: { ...state, status: "timing" }, effects: [{ type: "expire", token: state.token }] }
  }

  if (event.type === "elapsed" && (state.status !== "timing" || state.token !== event.token)) return { state, effects: [] }

  return { state: { status: "none", issued: state.issued }, effects: [] }
}

/** The token of the guard that holds the tab `key`, which takes no input while there is one. */
export function selectArrivalGuard(state: ArrivalGuardState, key: string) {
  return state.status !== "none" && state.key === key ? state.token : undefined
}
