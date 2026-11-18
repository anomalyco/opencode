// The "Add SSH server" dialog, whose chunk loads on the first click. Each load takes the next attempt number, so a load
// the plugin's cleanup overtook never opens its dialog.

/** How long the dialog's chunk may take to load before the click fails. */
export const SSH_DIALOG_LOAD_TIMEOUT_MS = 15_000

/**
 * - `idle`: no dialog loading; `issued` is the last attempt handed out.
 * - `loading`: the chunk loads; a second click joins it. `openProject` opens the server's project once it connects.
 * - `disposed`: the plugin instance went away.
 */
export type SshAddState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "loading"; readonly attempt: number; readonly openProject: boolean }
  | { readonly status: "disposed" }

export type SshAddEvent<M> =
  | { readonly type: "add.requested"; readonly openProject: boolean }
  | { readonly type: "add.loaded"; readonly attempt: number; readonly module: M }
  /** The chunk failed to load or ran out of time. */
  | { readonly type: "add.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "disposed" }

export type SshAddEffect<M> =
  | { readonly type: "load"; readonly attempt: number }
  | { readonly type: "open"; readonly module: M; readonly openProject: boolean }
  | { readonly type: "toast-failed"; readonly error: string }

export type SshAddTransition<M> = { readonly state: SshAddState; readonly effects: readonly SshAddEffect<M>[] }

export const initialSshAdd: SshAddState = { status: "idle", issued: 0 }

export function transitionSshAdd<M>(state: SshAddState, event: SshAddEvent<M>): SshAddTransition<M> {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return unchanged({ status: "disposed" })

  if (event.type === "add.requested") {
    // A second click joins the dialog already loading; the command's project choice wins over the menu's.
    if (state.status === "loading")
      return unchanged(event.openProject && !state.openProject ? { ...state, openProject: true } : state)
    const attempt = state.issued + 1

    return {
      state: { status: "loading", attempt, openProject: event.openProject },
      effects: [{ type: "load", attempt }],
    }
  }

  if (state.status !== "loading" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "add.loaded")
    return {
      state: { status: "idle", issued: state.attempt },
      effects: [{ type: "open", module: event.module, openProject: state.openProject }],
    }

  return { state: { status: "idle", issued: state.attempt }, effects: [{ type: "toast-failed", error: event.error }] }
}

function unchanged<M>(state: SshAddState): SshAddTransition<M> {
  return { state, effects: [] }
}
