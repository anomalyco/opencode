import type { ConnectionRefreshOutcome } from "./connection-refresh"

/** The model picker a first connection opens: it loads the catalogs the sign-in changed while it is already open. */
export type ConnectedModelsState =
  | { readonly status: "refreshing"; readonly attempt: number }
  | { readonly status: "settled"; readonly attempt: number; readonly outcome: ConnectionRefreshOutcome }
  | { readonly status: "disposed" }

export type ConnectedModelsEvent =
  /** Refresh models, from the picker's empty state. */
  | { readonly type: "refresh.requested" }
  | { readonly type: "refresh.settled"; readonly attempt: number; readonly outcome: ConnectionRefreshOutcome }
  | { readonly type: "disposed" }

export type ConnectedModelsEffect = { readonly type: "refresh"; readonly attempt: number }

export type ConnectedModelsTransition = {
  readonly state: ConnectedModelsState
  readonly effects: readonly ConnectedModelsEffect[]
}

const NO_EFFECTS: readonly ConnectedModelsEffect[] = []

/** The picker opens refreshing, before the first catalog read returns. */
export function startConnectedModels(): ConnectedModelsTransition {
  return { state: { status: "refreshing", attempt: 1 }, effects: [{ type: "refresh", attempt: 1 }] }
}

export function transitionConnectedModels(
  state: ConnectedModelsState,
  event: ConnectedModelsEvent,
): ConnectedModelsTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: NO_EFFECTS }

  if (event.type === "refresh.requested") {
    if (state.status === "refreshing") return { state, effects: NO_EFFECTS }
    const attempt = state.attempt + 1

    return { state: { status: "refreshing", attempt }, effects: [{ type: "refresh", attempt }] }
  }

  if (state.status !== "refreshing" || state.attempt !== event.attempt) return { state, effects: NO_EFFECTS }

  return { state: { status: "settled", attempt: state.attempt, outcome: event.outcome }, effects: NO_EFFECTS }
}

/**
 * What the picker shows when the provider lists no models yet: a loader while the catalogs load, then why it is
 * empty. A Console workspace without models links to the Console, where its setup is fixed.
 */
export function selectConnectedModelsEmpty(state: ConnectedModelsState, console: boolean) {
  if (state.status !== "settled") return { kind: "loading" } as const

  if (state.outcome === "failed") return { kind: "failed" } as const

  if (state.outcome === "timed-out") return { kind: "pending" } as const

  return console ? ({ kind: "console" } as const) : ({ kind: "none" } as const)
}
