/** A branch that has not loaded by then shows a placeholder; faster loads paint the name directly. */
export const CHECKOUT_PLACEHOLDER_DELAY_MS = 250

/**
 * The main checkout's branch label in the worktree trigger. While the checkout's Git info is missing it `waiting`s,
 * then shows a placeholder (`skeleton`) once the delay passes. `loaded` covers both a branch and a checkout without
 * one (detached HEAD, no commits), which shows the icon alone.
 */
export type CheckoutLabelState =
  | { readonly status: "loaded"; readonly attempt: number }
  | { readonly status: "waiting"; readonly directory: string; readonly attempt: number }
  | { readonly status: "skeleton"; readonly directory: string; readonly attempt: number }
  | { readonly status: "disposed" }

export type CheckoutLabelEvent =
  | { readonly type: "checkout.changed"; readonly directory: string; readonly loaded: boolean }
  | { readonly type: "delay.elapsed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type CheckoutLabelEffect =
  | { readonly type: "delay.start"; readonly attempt: number }
  | { readonly type: "delay.stop"; readonly attempt: number }

export type CheckoutLabelTransition = {
  readonly state: CheckoutLabelState
  readonly effects: readonly CheckoutLabelEffect[]
}

export const INITIAL_CHECKOUT_LABEL_STATE: CheckoutLabelState = Object.freeze({ status: "loaded", attempt: 0 })

const NONE: readonly CheckoutLabelEffect[] = Object.freeze([])

export function transitionCheckoutLabel(state: CheckoutLabelState, event: CheckoutLabelEvent): CheckoutLabelTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: stop(state) }

  if (event.type === "delay.elapsed") {
    if (state.status !== "waiting" || state.attempt !== event.attempt) return unchanged(state)

    return { state: { status: "skeleton", directory: state.directory, attempt: state.attempt }, effects: NONE }
  }

  if (event.loaded) {
    if (state.status === "loaded") return unchanged(state)

    return { state: { status: "loaded", attempt: state.attempt }, effects: stop(state) }
  }

  if (state.status !== "loaded" && state.directory === event.directory) return unchanged(state)
  const attempt = state.attempt + 1

  return {
    state: { status: "waiting", directory: event.directory, attempt },
    effects: [...stop(state), { type: "delay.start", attempt }],
  }
}

export function selectCheckoutSkeleton(state: CheckoutLabelState) {
  return state.status === "skeleton"
}

function stop(state: CheckoutLabelState): readonly CheckoutLabelEffect[] {
  return state.status === "waiting" ? [{ type: "delay.stop", attempt: state.attempt }] : NONE
}

function unchanged(state: CheckoutLabelState): CheckoutLabelTransition {
  return { state, effects: NONE }
}
