import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

export const HOME_SESSION_LONG_PRESS_MS = 500

/** How far a touch may drift before it is a scroll rather than a long press. */
export const HOME_SESSION_LONG_PRESS_SLOP_PX = 8

export const HOME_SESSION_RENAME_TIMEOUT_MS = 15_000

/**
 * The Home session rows' context menu, touch long press and inline rename. One row at a time owns a gesture. It lives at
 * the list root, so it survives a row remounting when its session moves to another date group.
 *
 * A long press opens the menu while the finger is still down, and the browser then sends a click for the release:
 * `suppressClick` swallows it once. It moves to `idle` when the menu closes before that click arrives. `renaming` keeps
 * the draft, so a failed or timed-out save returns to `editing` with it.
 */
export type HomeSessionRowState =
  | { readonly status: "idle"; readonly issued: number; readonly suppressClick: string | undefined }
  | {
      readonly status: "pressing"
      readonly issued: number
      readonly attempt: number
      readonly sessionID: string
      readonly x: number
      readonly y: number
      readonly menuX: number
      readonly menuY: number
    }
  | {
      readonly status: "menu"
      readonly issued: number
      readonly sessionID: string
      readonly x: number
      readonly y: number
      readonly suppressClick: boolean
      readonly outside: boolean
    }
  | { readonly status: "editing"; readonly issued: number; readonly sessionID: string; readonly draft: string }
  | {
      readonly status: "renaming"
      readonly issued: number
      readonly attempt: number
      readonly sessionID: string
      readonly draft: string
    }
  | { readonly status: "disposed" }

export type HomeSessionRowEvent =
  | {
      readonly type: "touch.down"
      readonly sessionID: string
      readonly x: number
      readonly y: number
      readonly menuX: number
      readonly menuY: number
    }
  /** A mouse or pen press: any press ends the wait for a long press's release click. */
  | { readonly type: "pointer.down" }
  | { readonly type: "touch.move"; readonly x: number; readonly y: number }
  | { readonly type: "touch.up" }
  | { readonly type: "touch.cancel" }
  | { readonly type: "long-press.fired"; readonly attempt: number }
  | { readonly type: "row.clicked"; readonly sessionID: string }
  | { readonly type: "menu.open"; readonly sessionID: string; readonly x: number; readonly y: number }
  | { readonly type: "menu.interact-outside"; readonly sessionID: string }
  | { readonly type: "menu.closed"; readonly sessionID: string }
  | { readonly type: "rename.start"; readonly sessionID: string; readonly title: string }
  | { readonly type: "editor.input"; readonly sessionID: string; readonly draft: string }
  | { readonly type: "editor.cancel"; readonly sessionID: string; readonly reason: "escape" | "blur" }
  | {
      readonly type: "editor.submit"
      readonly sessionID: string
      readonly server: ServerConnection.Key
      readonly session: SessionInfo
      /** The title the row shows now; submitting it unchanged saves nothing. */
      readonly title: string
    }
  | { readonly type: "rename.succeeded"; readonly attempt: number }
  | { readonly type: "rename.failed"; readonly attempt: number }
  | { readonly type: "rename.timed-out"; readonly attempt: number }
  | { readonly type: "sessions.synced"; readonly sessionIDs: ReadonlySet<string> }
  | { readonly type: "disposed" }

export type HomeSessionRowEffect =
  | { readonly type: "long-press.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "long-press.stop" }
  | {
      readonly type: "rename.save"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly session: SessionInfo
      readonly title: string
      readonly timeoutMs: number
    }
  | { readonly type: "rename.abort"; readonly attempt: number }
  | { readonly type: "toast.rename-timeout" }
  /** `ifOwned`: only when focus is still on the row or nowhere, so a late result never steals focus. */
  | { readonly type: "focus.row"; readonly sessionID: string; readonly ifOwned: boolean }
  | { readonly type: "focus.editor"; readonly sessionID: string; readonly select: boolean; readonly ifOwned: boolean }

export type HomeSessionRowTransition = {
  readonly state: HomeSessionRowState
  readonly effects: readonly HomeSessionRowEffect[]
}

type LiveState = Exclude<HomeSessionRowState, { status: "disposed" }>

export const INITIAL_HOME_SESSION_ROW_STATE: HomeSessionRowState = Object.freeze({
  status: "idle",
  issued: 0,
  suppressClick: undefined,
})

const DISPOSED: HomeSessionRowState = Object.freeze({ status: "disposed" })

const NONE: readonly HomeSessionRowEffect[] = Object.freeze([])

const STOP: readonly HomeSessionRowEffect[] = Object.freeze([{ type: "long-press.stop" }])

export function transitionHomeSessionRow(
  state: HomeSessionRowState,
  event: HomeSessionRowEvent,
): HomeSessionRowTransition {
  if (state.status === "disposed") return unchanged(state)

  // A save in flight finishes in the background: the server may already have it, and the list then shows it.
  if (event.type === "disposed") return { state: DISPOSED, effects: stop(state) }

  if (event.type === "touch.down") {
    if ((state.status === "editing" || state.status === "renaming") && state.sessionID === event.sessionID)
      return unchanged(state)

    const attempt = state.issued + 1

    return {
      state: {
        status: "pressing",
        issued: attempt,
        attempt,
        sessionID: event.sessionID,
        x: event.x,
        y: event.y,
        menuX: event.menuX,
        menuY: event.menuY,
      },
      effects: [...stop(state), { type: "long-press.start", attempt, delayMs: HOME_SESSION_LONG_PRESS_MS }],
    }
  }

  if (event.type === "pointer.down" || event.type === "touch.cancel") {
    if (event.type === "touch.cancel" && state.status === "pressing") return toIdle(state, STOP)

    return released(state)
  }

  if (event.type === "touch.move") {
    if (!selectLongPressMoved(state, event.x, event.y)) return unchanged(state)

    return toIdle(state, STOP)
  }

  if (event.type === "touch.up") return state.status === "pressing" ? toIdle(state, STOP) : unchanged(state)

  if (event.type === "long-press.fired") {
    if (state.status !== "pressing" || state.attempt !== event.attempt) return unchanged(state)

    return changed(menu(state, state.sessionID, state.menuX, state.menuY, true))
  }

  if (event.type === "row.clicked")
    return selectRowSuppressClick(state, event.sessionID, 1) ? released(state) : unchanged(state)

  if (event.type === "menu.open") return opened(state, event)

  if (event.type === "menu.interact-outside") {
    if (state.status !== "menu" || state.sessionID !== event.sessionID || state.outside) return unchanged(state)

    return changed({ ...state, outside: true })
  }

  if (event.type === "menu.closed") {
    if (state.status !== "menu" || state.sessionID !== event.sessionID) return unchanged(state)

    return {
      state: idle(state, state.suppressClick ? state.sessionID : undefined),
      // A dismissal by interacting elsewhere leaves focus where the user put it.
      effects: state.outside ? NONE : [{ type: "focus.row", sessionID: state.sessionID, ifOwned: false }],
    }
  }

  if (event.type === "rename.start") {
    return {
      state: { status: "editing", issued: state.issued, sessionID: event.sessionID, draft: event.title },
      effects: [...stop(state), { type: "focus.editor", sessionID: event.sessionID, select: true, ifOwned: false }],
    }
  }

  if (event.type === "editor.input") {
    if (state.status !== "editing" || state.sessionID !== event.sessionID || state.draft === event.draft)
      return unchanged(state)

    return changed({ ...state, draft: event.draft })
  }

  if (event.type === "editor.cancel") return cancelled(state, event)

  if (event.type === "editor.submit") return submitted(state, event)

  if (event.type === "sessions.synced") {
    if (state.status === "idle" || event.sessionIDs.has(state.sessionID)) return unchanged(state)

    return toIdle(state, stop(state))
  }

  return settled(state, event)
}

/** The row's open menu, positioned in the row, or undefined. */
export function selectRowMenu(state: HomeSessionRowState, sessionID: string) {
  return state.status === "menu" && state.sessionID === sessionID ? state : undefined
}

/** The row's rename editor, or undefined while it shows as a button. */
export function selectRowEditor(state: HomeSessionRowState, sessionID: string) {
  return (state.status === "editing" || state.status === "renaming") && state.sessionID === sessionID
    ? state
    : undefined
}

/** A click on the row is the release of a long press that opened its menu. Keyboard activation (`detail` 0) never is. */
export function selectRowSuppressClick(state: HomeSessionRowState, sessionID: string, detail: number) {
  if (detail === 0) return false

  if (state.status === "menu") return state.sessionID === sessionID && state.suppressClick

  return state.status === "idle" && state.suppressClick === sessionID
}

/** A touch moved past the slop while waiting for a long press. Pointer moves are checked here before any event. */
export function selectLongPressMoved(state: HomeSessionRowState, x: number, y: number) {
  return (
    state.status === "pressing" &&
    (Math.abs(x - state.x) > HOME_SESSION_LONG_PRESS_SLOP_PX || Math.abs(y - state.y) > HOME_SESSION_LONG_PRESS_SLOP_PX)
  )
}

// An Android long press also sends `contextmenu`; it opens the same menu and still owes the release click.
function opened(
  state: LiveState,
  event: Extract<HomeSessionRowEvent, { type: "menu.open" }>,
): HomeSessionRowTransition {
  if (state.status === "editing" || state.status === "renaming") {
    // The editor keeps the native menu, so paste and spelling work.
    if (state.sessionID === event.sessionID) return unchanged(state)
  }

  if (state.status === "menu" && state.sessionID === event.sessionID) {
    if (state.x === event.x && state.y === event.y) return unchanged(state)

    return changed({ ...state, x: event.x, y: event.y })
  }

  const pressed = state.status === "pressing" && state.sessionID === event.sessionID

  return { state: menu(state, event.sessionID, event.x, event.y, pressed), effects: stop(state) }
}

function cancelled(
  state: LiveState,
  event: Extract<HomeSessionRowEvent, { type: "editor.cancel" }>,
): HomeSessionRowTransition {
  if ((state.status !== "editing" && state.status !== "renaming") || state.sessionID !== event.sessionID)
    return unchanged(state)

  const focus: HomeSessionRowEffect = { type: "focus.row", sessionID: state.sessionID, ifOwned: false }

  if (state.status === "editing") return toIdle(state, event.reason === "escape" ? [focus] : NONE)

  // Clicking away while a save is in flight lets it finish; Escape cancels it.
  if (event.reason === "blur") return unchanged(state)

  return toIdle(state, [{ type: "rename.abort", attempt: state.attempt }, focus])
}

function submitted(
  state: LiveState,
  event: Extract<HomeSessionRowEvent, { type: "editor.submit" }>,
): HomeSessionRowTransition {
  if (state.status !== "editing" || state.sessionID !== event.sessionID) return unchanged(state)
  const title = state.draft.trim()

  if (!title || title === event.title)
    return toIdle(state, [{ type: "focus.row", sessionID: state.sessionID, ifOwned: false }])

  const attempt = state.issued + 1

  return {
    state: { status: "renaming", issued: attempt, attempt, sessionID: state.sessionID, draft: state.draft },
    effects: [
      {
        type: "rename.save",
        attempt,
        server: event.server,
        session: event.session,
        title,
        timeoutMs: HOME_SESSION_RENAME_TIMEOUT_MS,
      },
    ],
  }
}

function settled(
  state: LiveState,
  event: Extract<HomeSessionRowEvent, { type: "rename.succeeded" | "rename.failed" | "rename.timed-out" }>,
): HomeSessionRowTransition {
  if (state.status !== "renaming" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "rename.succeeded")
    return toIdle(state, [{ type: "focus.row", sessionID: state.sessionID, ifOwned: true }])

  const focus: HomeSessionRowEffect = { type: "focus.editor", sessionID: state.sessionID, select: false, ifOwned: true }

  return {
    state: { status: "editing", issued: state.issued, sessionID: state.sessionID, draft: state.draft },
    effects:
      event.type === "rename.failed"
        ? [focus]
        : [{ type: "rename.abort", attempt: state.attempt }, { type: "toast.rename-timeout" }, focus],
  }
}

// Ends the wait for a long press's release click.
function released(state: LiveState): HomeSessionRowTransition {
  if (state.status === "menu" && state.suppressClick) return changed({ ...state, suppressClick: false })

  if (state.status === "idle" && state.suppressClick !== undefined) return changed(idle(state, undefined))

  return unchanged(state)
}

function menu(state: LiveState, sessionID: string, x: number, y: number, suppressClick: boolean): HomeSessionRowState {
  return { status: "menu", issued: state.issued, sessionID, x, y, suppressClick, outside: false }
}

function idle(state: LiveState, suppressClick: string | undefined): HomeSessionRowState {
  return { status: "idle", issued: state.issued, suppressClick }
}

function toIdle(state: LiveState, effects: readonly HomeSessionRowEffect[]): HomeSessionRowTransition {
  return { state: idle(state, undefined), effects }
}

function stop(state: LiveState) {
  return state.status === "pressing" ? STOP : NONE
}

function changed(state: HomeSessionRowState): HomeSessionRowTransition {
  return { state, effects: NONE }
}

function unchanged(state: HomeSessionRowState): HomeSessionRowTransition {
  return { state, effects: NONE }
}
