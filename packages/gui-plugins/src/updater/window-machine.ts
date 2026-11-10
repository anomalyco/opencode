/** How long loading the actions chunk may take, so a missing or stalled chunk never holds the window's update actions. */
export const ACTION_CHUNK_TIMEOUT_MS = 15_000

/**
 * The update action this window asked for. Main's updater state says what the app is doing; this says what the window
 * is doing about it, so a second request joins the first instead of showing a second "Checking…" toast and result.
 * - `idle`: nothing asked; `issued` is the last attempt handed out.
 * - `checking`: a check runs, with its toast, until it reports what it found.
 * - `installing`: the install is being handed to main, or its download confirmed.
 * - `disposed`: the window let the updater go.
 */
export type WindowUpdaterState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "checking"; readonly attempt: number }
  | { readonly status: "installing"; readonly attempt: number }
  | { readonly status: "disposed" }

export type WindowUpdaterEvent =
  /** The user asked from the menu, a command, Settings or the titlebar. `available` is false while main is missing. */
  | { readonly type: "action.requested"; readonly action: "check" | "install"; readonly available: boolean }
  /** The action finished and answered the user. */
  | { readonly type: "action.settled"; readonly attempt: number }
  /** The actions chunk failed to load or ran out of time, so the action never started. */
  | { readonly type: "action.failed"; readonly attempt: number; readonly message?: string }
  | { readonly type: "disposed" }

export type WindowUpdaterEffect =
  /** Loads the actions chunk under `ACTION_CHUNK_TIMEOUT_MS` and runs the action. */
  | { readonly type: "run"; readonly action: "check" | "install"; readonly attempt: number }
  | { readonly type: "toast-failed"; readonly message?: string }

export type WindowUpdaterTransition = {
  readonly state: WindowUpdaterState
  readonly effects: readonly WindowUpdaterEffect[]
}

export const initialWindowUpdater: WindowUpdaterState = { status: "idle", issued: 0 }

export function transitionWindowUpdater(state: WindowUpdaterState, event: WindowUpdaterEvent): WindowUpdaterTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return unchanged({ status: "disposed" })

  if (event.type === "action.requested") {
    if (state.status === "installing") return unchanged(state)

    // Not loaded yet, or not active (failed, or not on this platform): nothing can check or install.
    if (!event.available)
      return state.status === "idle" ? unchanged(state, [{ type: "toast-failed" }]) : unchanged(state)

    if (state.status === "checking" && event.action === "check") return unchanged(state)
    // An install asked for during a check takes over; the check's answer no longer settles anything.
    const attempt = (state.status === "idle" ? state.issued : state.attempt) + 1

    return {
      state: event.action === "check" ? { status: "checking", attempt } : { status: "installing", attempt },
      effects: [{ type: "run", action: event.action, attempt }],
    }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "action.settled") return unchanged({ status: "idle", issued: state.attempt })

  return {
    state: { status: "idle", issued: state.attempt },
    effects: [{ type: "toast-failed", message: event.message }],
  }
}

function unchanged(state: WindowUpdaterState, effects: readonly WindowUpdaterEffect[] = []): WindowUpdaterTransition {
  return { state, effects }
}
