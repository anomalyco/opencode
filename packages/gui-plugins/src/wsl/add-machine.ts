// The "Add WSL server" dialog, whose chunk loads on the first click. Each load takes the next attempt number, so a load
// the plugin's cleanup overtook never opens its dialog.

/** How long the dialog's chunk may take to load before the click fails. */
export const WSL_DIALOG_LOAD_TIMEOUT_MS = 15_000

/**
 * - `idle`: no dialog loading; `issued` is the last attempt handed out.
 * - `loading`: the chunk loads; a second click joins it.
 * - `disposed`: the plugin instance went away.
 */
export type WslAddState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "disposed" }

export type WslAddEvent<M> =
  | { readonly type: "add.requested" }
  | { readonly type: "add.loaded"; readonly attempt: number; readonly module: M }
  /** The chunk failed to load or ran out of time. */
  | { readonly type: "add.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type WslAddEffect<M> =
  | { readonly type: "load"; readonly attempt: number }
  | { readonly type: "open"; readonly module: M }
  | { readonly type: "toast-failed"; readonly error: string }

export type WslAddTransition<M> = { readonly state: WslAddState; readonly effects: readonly WslAddEffect<M>[] }

export const initialWslAdd: WslAddState = { status: "idle", issued: 0 }

export function transitionWslAdd<M>(state: WslAddState, event: WslAddEvent<M>): WslAddTransition<M> {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return unchanged({ status: "disposed" })

  if (event.type === "add.requested") {
    // A second click joins the dialog already loading.
    if (state.status === "loading") return unchanged(state)
    const attempt = state.issued + 1

    return { state: { status: "loading", attempt }, effects: [{ type: "load", attempt }] }
  }

  if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "add.loaded")
    return { state: { status: "idle", issued: state.attempt }, effects: [{ type: "open", module: event.module }] }

  return { state: { status: "idle", issued: state.attempt }, effects: [{ type: "toast-failed", error: event.error }] }
}

function unchanged<M>(state: WslAddState): WslAddTransition<M> {
  return { state, effects: [] }
}
