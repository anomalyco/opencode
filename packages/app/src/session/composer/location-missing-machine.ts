import type { WorktreeDirectory } from "@opencode/client/promise"
import { getFilename, sameDirectory } from "@opencode/util/path"

/** The menu shows what it already has, with an error, once a worktree refresh and list take this long. */
export const WORKTREES_LOAD_TIMEOUT_MS = 15_000

/** A move the server accepted waits this long for the session's new Location to unmount the notice. */
export const LOCATION_MOVE_SETTLE_TIMEOUT_MS = 5_000

export type LocationMissingSource = "worktree" | "directory"

type LocationMissingBase = {
  readonly issued: number
  /** The project's worktrees as last loaded, shown at once when the menu opens. */
  readonly worktrees: readonly WorktreeDirectory[]
}

/**
 * Recovering a session whose folder is gone. `picking`: the directory picker is open. `moving`: the worktree or move
 * request runs. `moved`: the server moved the session and the notice waits for the new Location to replace it.
 * `restoreFocus`: a cancelled or failed move returns focus to Choose directory once the dialog over it closes.
 */
export type LocationMissingState =
  | (LocationMissingBase & { readonly status: "idle"; readonly restoreFocus: boolean })
  | (LocationMissingBase & { readonly status: "menu-loading"; readonly attempt: number; readonly search: string })
  | (LocationMissingBase & { readonly status: "menu-ready"; readonly search: string })
  | (LocationMissingBase & { readonly status: "picking"; readonly attempt: number })
  | (LocationMissingBase & {
      readonly status: "moving" | "moved"
      readonly attempt: number
      readonly source: LocationMissingSource
    })
  | { readonly status: "disposed" }

export type LocationMissingEvent =
  | { readonly type: "menu.toggled"; readonly open: boolean }
  | { readonly type: "search.changed"; readonly search: string }
  | {
      readonly type: "worktrees.loaded"
      readonly attempt: number
      readonly items: readonly WorktreeDirectory[] | undefined
    }
  | { readonly type: "worktrees.timed-out"; readonly attempt: number }
  | { readonly type: "choose.requested" }
  | {
      readonly type: "picker.settled"
      readonly attempt: number
      readonly directory: string | undefined
      readonly dialogOpen: boolean
    }
  | { readonly type: "move.worktree"; readonly directory?: string }
  | { readonly type: "move.succeeded"; readonly attempt: number }
  | { readonly type: "move.failed"; readonly attempt: number; readonly error: unknown; readonly dialogOpen: boolean }
  | { readonly type: "move.settle-timed-out"; readonly attempt: number }
  | { readonly type: "dialog.changed"; readonly open: boolean }
  | { readonly type: "disposed" }

export type LocationMissingEffect =
  | { readonly type: "worktrees.load"; readonly attempt: number }
  | { readonly type: "picker.open"; readonly attempt: number }
  /** Without `directory`, the move first creates a worktree from the project's checkout. */
  | { readonly type: "move.run"; readonly attempt: number; readonly directory?: string }
  | { readonly type: "timer.start"; readonly attempt: number; readonly phase: "menu-loading" | "moved" }
  | { readonly type: "timer.cancel" }
  | { readonly type: "focus.choose" }
  | { readonly type: "toast.worktrees-failed" }
  | { readonly type: "toast.move-failed"; readonly error: unknown }

export type LocationMissingTransition = {
  readonly state: LocationMissingState
  readonly effects: readonly LocationMissingEffect[]
}

const TIMER_CANCEL: LocationMissingEffect = { type: "timer.cancel" }

export function createLocationMissingState(worktrees: readonly WorktreeDirectory[]): LocationMissingState {
  return { status: "idle", issued: 0, worktrees, restoreFocus: false }
}

export function transitionLocationMissing(
  state: LocationMissingState,
  event: LocationMissingEvent,
): LocationMissingTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return changed(
      { status: "disposed" },
      state.status === "menu-loading" || state.status === "moved" ? [TIMER_CANCEL] : [],
    )

  const base = { issued: state.issued, worktrees: state.worktrees }
  const loading = state.status === "menu-loading" ? [TIMER_CANCEL] : []

  if (event.type === "menu.toggled") {
    if (event.open && state.status === "idle") {
      const attempt = state.issued + 1

      return changed({ ...base, issued: attempt, status: "menu-loading", attempt, search: "" }, [
        { type: "worktrees.load", attempt },
        { type: "timer.start", attempt, phase: "menu-loading" },
      ])
    }

    if (!event.open && (state.status === "menu-loading" || state.status === "menu-ready"))
      return changed({ ...base, status: "idle", restoreFocus: false }, loading)

    return unchanged(state)
  }

  if (event.type === "search.changed") {
    if ((state.status !== "menu-loading" && state.status !== "menu-ready") || state.search === event.search)
      return unchanged(state)

    return changed({ ...state, search: event.search })
  }

  if (event.type === "worktrees.loaded" || event.type === "worktrees.timed-out") {
    if (state.status !== "menu-loading" || state.attempt !== event.attempt) return unchanged(state)
    const items = event.type === "worktrees.loaded" ? event.items : undefined

    return changed({ ...base, worktrees: items ?? state.worktrees, status: "menu-ready", search: state.search }, [
      TIMER_CANCEL,
      ...(items ? [] : [{ type: "toast.worktrees-failed" as const }]),
    ])
  }

  if (event.type === "choose.requested") {
    if (state.status !== "idle" && state.status !== "menu-loading" && state.status !== "menu-ready")
      return unchanged(state)
    const attempt = state.issued + 1

    return changed({ ...base, issued: attempt, status: "picking", attempt }, [
      ...loading,
      { type: "picker.open", attempt },
    ])
  }

  if (event.type === "picker.settled") {
    if (state.status !== "picking" || state.attempt !== event.attempt) return unchanged(state)

    if (!event.directory) return cancelled(base, event.dialogOpen)

    return move(base, "directory", event.directory)
  }

  if (event.type === "move.worktree") {
    if (state.status !== "idle" && state.status !== "menu-loading" && state.status !== "menu-ready")
      return unchanged(state)
    const next = move(base, "worktree", event.directory)

    return changed(next.state, [...loading, ...next.effects])
  }

  if (event.type === "move.succeeded") {
    if (state.status !== "moving" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ ...state, status: "moved" }, [{ type: "timer.start", attempt: state.attempt, phase: "moved" }])
  }

  if (event.type === "move.failed") {
    if (state.status !== "moving" || state.attempt !== event.attempt) return unchanged(state)
    const next = cancelled(base, event.dialogOpen)

    return changed(next.state, [{ type: "toast.move-failed", error: event.error }, ...next.effects])
  }

  if (event.type === "move.settle-timed-out") {
    if (state.status !== "moved" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ ...base, status: "idle", restoreFocus: false }, [TIMER_CANCEL])
  }

  if (event.open || state.status !== "idle" || !state.restoreFocus) return unchanged(state)

  return changed({ ...state, restoreFocus: false }, [{ type: "focus.choose" }])
}

export function selectLocationMissingView(state: LocationMissingState, directory: string) {
  const live = state.status === "disposed" ? undefined : state
  const search = live && "search" in live ? live.search : ""
  const others = (live?.worktrees ?? []).filter((item) => item.strategy && !sameDirectory(item.directory, directory))
  const query = search.trim().toLowerCase()
  const matches = query ? others.filter((item) => getFilename(item.directory).toLowerCase().includes(query)) : others
  const loading = state.status === "menu-loading" && others.length === 0
  const pending = state.status === "moving" || state.status === "moved" ? state.source : undefined

  return {
    menuOpen: state.status === "menu-loading" || state.status === "menu-ready",
    search,
    menuLoading: loading,
    hasMenuSeparator: loading || others.length > 0,
    searchable: others.length >= 10,
    emptySearch: !!query && matches.length === 0,
    visibleWorktrees: matches.slice(0, 10),
    /** One move at a time: the desktop's native picker leaves the window usable while it is open. */
    disabled: !!pending || state.status === "picking" || state.status === "disposed",
    pendingWorktree: pending === "worktree",
    pendingDirectory: pending === "directory",
  }
}

type Base = Pick<Exclude<LocationMissingState, { status: "disposed" }>, "issued" | "worktrees">

function move(base: Base, source: LocationMissingSource, directory: string | undefined): LocationMissingTransition {
  const attempt = base.issued + 1

  return changed({ ...base, issued: attempt, status: "moving", attempt, source }, [
    directory ? { type: "move.run", attempt, directory } : { type: "move.run", attempt },
  ])
}

// Focus returns to Choose directory now, or once the dialog over it closes.
function cancelled(base: Base, dialogOpen: boolean): LocationMissingTransition {
  return changed({ ...base, status: "idle", restoreFocus: dialogOpen }, dialogOpen ? [] : [{ type: "focus.choose" }])
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
