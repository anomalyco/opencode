/** A move the server accepted waits this long for the session's new Location to unmount the notice. */
export const LOCATION_MOVE_SETTLE_TIMEOUT_MS = 5_000

export type LocationMissingSource = "worktree" | "directory"

/**
 * Recovering a session whose folder is gone. `picking`: the directory picker is open. `moving`: the worktree or move
 * request runs. `moved`: the server moved the session and the notice waits for the new Location to replace it.
 * `restoreFocus`: a cancelled or failed move returns focus to Choose directory once the dialog over it closes.
 */
export type LocationMissingState =
  | { readonly status: "idle"; readonly issued: number; readonly restoreFocus: boolean }
  | { readonly status: "picking"; readonly issued: number; readonly attempt: number }
  | {
      readonly status: "moving" | "moved"
      readonly issued: number
      readonly attempt: number
      readonly source: LocationMissingSource
    }
  | { readonly status: "disposed" }

export type LocationMissingEvent =
  | { readonly type: "choose.requested" }
  | {
      readonly type: "picker.settled"
      readonly attempt: number
      readonly directory: string | undefined
      readonly dialogOpen: boolean
    }
  /** Without `directory`, the move first creates a worktree from the project's checkout. */
  | { readonly type: "move.worktree"; readonly directory?: string }
  | { readonly type: "move.succeeded"; readonly attempt: number }
  | { readonly type: "move.failed"; readonly attempt: number; readonly error: unknown; readonly dialogOpen: boolean }
  | { readonly type: "move.settle-timed-out"; readonly attempt: number }
  | { readonly type: "dialog.changed"; readonly open: boolean }
  | { readonly type: "disposed" }

export type LocationMissingEffect =
  | { readonly type: "picker.open"; readonly attempt: number }
  /** Without `directory`, the move first creates a worktree from the project's checkout. */
  | { readonly type: "move.run"; readonly attempt: number; readonly directory?: string }
  | { readonly type: "timer.start"; readonly attempt: number }
  | { readonly type: "timer.cancel" }
  | { readonly type: "focus.choose" }
  | { readonly type: "toast.move-failed"; readonly error: unknown }

export type LocationMissingTransition = {
  readonly state: LocationMissingState
  readonly effects: readonly LocationMissingEffect[]
}

const TIMER_CANCEL: LocationMissingEffect = { type: "timer.cancel" }

export function createLocationMissingState(): LocationMissingState {
  return { status: "idle", issued: 0, restoreFocus: false }
}

export function transitionLocationMissing(
  state: LocationMissingState,
  event: LocationMissingEvent,
): LocationMissingTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return changed({ status: "disposed" }, state.status === "moved" ? [TIMER_CANCEL] : [])

  if (event.type === "choose.requested") {
    if (state.status !== "idle") return unchanged(state)
    const attempt = state.issued + 1

    return changed({ status: "picking", issued: attempt, attempt }, [{ type: "picker.open", attempt }])
  }

  if (event.type === "picker.settled") {
    if (state.status !== "picking" || state.attempt !== event.attempt) return unchanged(state)

    if (!event.directory) return cancelled(state.issued, event.dialogOpen)

    return move(state.issued, "directory", event.directory)
  }

  if (event.type === "move.worktree") {
    if (state.status !== "idle") return unchanged(state)

    return move(state.issued, "worktree", event.directory)
  }

  if (event.type === "move.succeeded") {
    if (state.status !== "moving" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ ...state, status: "moved" }, [{ type: "timer.start", attempt: state.attempt }])
  }

  if (event.type === "move.failed") {
    if (state.status !== "moving" || state.attempt !== event.attempt) return unchanged(state)
    const next = cancelled(state.issued, event.dialogOpen)

    return changed(next.state, [{ type: "toast.move-failed", error: event.error }, ...next.effects])
  }

  if (event.type === "move.settle-timed-out") {
    if (state.status !== "moved" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ status: "idle", issued: state.issued, restoreFocus: false }, [TIMER_CANCEL])
  }

  if (event.open || state.status !== "idle" || !state.restoreFocus) return unchanged(state)

  return changed({ ...state, restoreFocus: false }, [{ type: "focus.choose" }])
}

export function selectLocationMissingView(state: LocationMissingState) {
  const pending = state.status === "moving" || state.status === "moved" ? state.source : undefined

  return {
    /** One move at a time: the desktop's native picker leaves the window usable while it is open. */
    disabled: state.status !== "idle",
    pendingWorktree: pending === "worktree",
    pendingDirectory: pending === "directory",
  }
}

function move(issued: number, source: LocationMissingSource, directory: string | undefined): LocationMissingTransition {
  const attempt = issued + 1

  return changed({ status: "moving", issued: attempt, attempt, source }, [
    directory ? { type: "move.run", attempt, directory } : { type: "move.run", attempt },
  ])
}

// Focus returns to Choose directory now, or once the dialog over it closes.
function cancelled(issued: number, dialogOpen: boolean): LocationMissingTransition {
  return changed({ status: "idle", issued, restoreFocus: dialogOpen }, dialogOpen ? [] : [{ type: "focus.choose" }])
}

function changed(
  state: LocationMissingState,
  effects: readonly LocationMissingEffect[] = [],
): LocationMissingTransition {
  return { state, effects }
}

function unchanged(state: LocationMissingState): LocationMissingTransition {
  return { state, effects: [] }
}
