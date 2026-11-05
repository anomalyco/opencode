// The drawer's exit transition takes 200ms; Settings opens anyway if it never reports the end.
export const MOBILE_TABS_CLOSE_TIMEOUT_MS = 500

/**
 * The phone tabs drawer. `closing-to-settings` lets the drawer slide out before Settings opens, so the two do not
 * fight over focus and history.
 */
export type MobileTabsState =
  | { readonly status: "closed"; readonly attempt: number }
  | { readonly status: "open"; readonly attempt: number }
  | { readonly status: "closing-to-settings"; readonly attempt: number }
  | { readonly status: "disposed" }

export type MobileTabsEvent =
  /** The drawer asks to open or close (trigger, swipe, outside tap, Escape). */
  | { readonly type: "drawer.changed"; readonly open: boolean }
  /** A tab, Home, New session or Help was picked. */
  | { readonly type: "close" }
  | { readonly type: "settings.requested" }
  | { readonly type: "content.present"; readonly present: boolean }
  | { readonly type: "close.timed-out"; readonly attempt: number }
  | { readonly type: "route.changed" }
  | { readonly type: "viewport.changed"; readonly mobile: boolean }
  | { readonly type: "disposed" }

export type MobileTabsEffect =
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.clear" }
  | { readonly type: "settings.open" }

export type MobileTabsTransition = {
  readonly state: MobileTabsState
  readonly effects: readonly MobileTabsEffect[]
}

export const INITIAL_MOBILE_TABS_STATE: MobileTabsState = Object.freeze({ status: "closed", attempt: 0 })

const DISPOSED: MobileTabsState = Object.freeze({ status: "disposed" })

const NONE: readonly MobileTabsEffect[] = []

const CLEAR: readonly MobileTabsEffect[] = [{ type: "timer.clear" }]

const OPEN_SETTINGS: readonly MobileTabsEffect[] = [{ type: "timer.clear" }, { type: "settings.open" }]

export function transitionMobileTabs(state: MobileTabsState, event: MobileTabsEvent): MobileTabsTransition {
  if (state.status === "disposed") return unchanged(state)
  const closing = state.status === "closing-to-settings"

  if (event.type === "disposed") return { state: DISPOSED, effects: closing ? CLEAR : NONE }

  if (event.type === "drawer.changed") {
    // A close the drawer reports while it slides out to Settings is the one already under way.
    if (event.open === (state.status === "open") || (closing && !event.open)) return unchanged(state)

    return { state: { status: event.open ? "open" : "closed", attempt: state.attempt }, effects: closing ? CLEAR : NONE }
  }

  if (event.type === "close" || event.type === "route.changed") {
    if (state.status === "closed") return unchanged(state)

    return { state: { status: "closed", attempt: state.attempt }, effects: closing ? CLEAR : NONE }
  }

  if (event.type === "settings.requested") {
    if (state.status !== "open") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "closing-to-settings", attempt },
      effects: [{ type: "timer.start", attempt, timeoutMs: MOBILE_TABS_CLOSE_TIMEOUT_MS }],
    }
  }

  if (event.type === "content.present") {
    if (!closing || event.present) return unchanged(state)

    return { state: { status: "closed", attempt: state.attempt }, effects: OPEN_SETTINGS }
  }

  if (event.type === "close.timed-out") {
    if (!closing || event.attempt !== state.attempt) return unchanged(state)

    return { state: { status: "closed", attempt: state.attempt }, effects: OPEN_SETTINGS }
  }

  // Leaving the phone layout unmounts the drawer before it can report the end of its exit.
  if (event.mobile || state.status === "closed") return unchanged(state)

  return { state: { status: "closed", attempt: state.attempt }, effects: closing ? OPEN_SETTINGS : NONE }
}

export function selectMobileTabsOpen(state: MobileTabsState) {
  return state.status === "open"
}

function unchanged(state: MobileTabsState): MobileTabsTransition {
  return { state, effects: NONE }
}
