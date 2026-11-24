// A catalog load that never settles must not open the dialog long after the click.
export const MODEL_CHIP_DEFER_TIMEOUT_MS = 10_000

// A previewed chip is visible before the model catalog loads. A click then waits in `deferred` for the catalog, and
// `attempt` names that wait so a timer from an earlier click cannot cancel a later one.
export type ModelChipState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "deferred"; readonly attempt: number; readonly detail: number }
  | { readonly status: "disposed" }

export type ModelChipEvent =
  | {
      readonly type: "clicked"
      readonly detail: number
      readonly loading: boolean
      readonly mobile: boolean
      readonly dialogOpen: boolean
    }
  | { readonly type: "loaded"; readonly mobile: boolean; readonly dialogOpen: boolean }
  | { readonly type: "cancelled" }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ModelChipEffect =
  | { readonly type: "open"; readonly detail: number }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.clear" }

export type ModelChipTransition = {
  readonly state: ModelChipState
  readonly effects: readonly ModelChipEffect[]
}

export function createModelChipState(): ModelChipState {
  return { status: "idle", attempt: 0 }
}

export function transitionModelChip(state: ModelChipState, event: ModelChipEvent): ModelChipTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "deferred" ? [{ type: "timer.clear" }] : [] }

  if (event.type === "clicked") {
    // On mobile the inert chip stands in for the drawer trigger, so a click there is dropped.
    if (!event.loading && !event.mobile) return settle(state, [{ type: "open", detail: event.detail }])

    if (event.mobile || event.dialogOpen) return settle(state, [])
    const attempt = state.attempt + 1

    return {
      state: { status: "deferred", attempt, detail: event.detail },
      effects: [{ type: "timer.start", attempt, delayMs: MODEL_CHIP_DEFER_TIMEOUT_MS }],
    }
  }

  if (state.status === "idle") return { state, effects: [] }

  if (event.type === "loaded")
    return settle(state, event.mobile || event.dialogOpen ? [] : [{ type: "open", detail: state.detail }])

  if (event.type === "cancelled") return settle(state, [])

  // The timer already fired, so it has nothing left to clear.
  if (event.attempt !== state.attempt) return { state, effects: [] }

  return { state: { status: "idle", attempt: state.attempt }, effects: [] }
}

/** Whether a click is waiting for the catalog, which the chip shows as busy. */
export function selectModelChipPending(state: ModelChipState) {
  return state.status === "deferred"
}

function settle(
  state: Extract<ModelChipState, { status: "idle" | "deferred" }>,
  effects: readonly ModelChipEffect[],
): ModelChipTransition {
  if (state.status === "idle") return { state, effects }

  return { state: { status: "idle", attempt: state.attempt }, effects: [{ type: "timer.clear" }, ...effects] }
}
