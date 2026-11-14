/**
 * A menu opens at most one submenu at a time. A submenu stays open while focus crosses the other items of its menu, so
 * the next submenu replaces it in the same frame, and the pointer can still reach it, instead of every move closing it
 * and leaving the menu without one until the next opens.
 */
export type SubmenuState =
  | { readonly status: "closed" }
  | { readonly status: "open"; readonly sub: string }
  /** Focus left the trigger for another item of the menu; the submenu closes unless focus returns or another opens. */
  | { readonly status: "leaving"; readonly sub: string }
  | { readonly status: "disposed" }

export type SubmenuEvent =
  /** Kobalte asked to open or close one submenu: a hover, click or key opened it, or Escape, ArrowLeft or a pick closed it. */
  | { readonly type: "requested"; readonly sub: string; readonly open: boolean }
  /** Focus moved to another item of the menu that holds the open submenu's trigger, or to that menu itself. */
  | { readonly type: "focus.left" }
  /** Focus came back to the open submenu's trigger, or moved into the submenu. */
  | { readonly type: "focus.returned" }
  /** The delay that the given `leaving` state started ran out. */
  | { readonly type: "leave.elapsed"; readonly state: SubmenuState }
  | { readonly type: "disposed" }

export const SUBMENU_CLOSED: SubmenuState = Object.freeze({ status: "closed" })

const DISPOSED: SubmenuState = Object.freeze({ status: "disposed" })

export const SUBMENU_FOCUS_LEFT: SubmenuEvent = Object.freeze({ type: "focus.left" })

export const SUBMENU_FOCUS_RETURNED: SubmenuEvent = Object.freeze({ type: "focus.returned" })

export const SUBMENU_DISPOSED: SubmenuEvent = Object.freeze({ type: "disposed" })

export function submenuRequested(sub: string, open: boolean): SubmenuEvent {
  return Object.freeze({ type: "requested", sub, open })
}

export function submenuLeaveElapsed(state: SubmenuState): SubmenuEvent {
  return Object.freeze({ type: "leave.elapsed", state })
}

export function transitionSubmenu(state: SubmenuState, event: SubmenuEvent): SubmenuState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED

  if (event.type === "requested") {
    if (event.open) return state.status === "open" && state.sub === event.sub ? state : open(event.sub)

    return state.status !== "closed" && state.sub === event.sub ? SUBMENU_CLOSED : state
  }

  if (state.status === "closed") return state

  // Each move away is a new state that restarts the delay, so the submenu outlives a pointer still crossing items.
  if (event.type === "focus.left") return Object.freeze({ status: "leaving", sub: state.sub })

  if (event.type === "focus.returned") return state.status === "leaving" ? open(state.sub) : state

  return event.state === state ? SUBMENU_CLOSED : state
}

export function selectSubmenuOpen(state: SubmenuState, sub: string) {
  return (state.status === "open" || state.status === "leaving") && state.sub === sub
}

const open = (sub: string): SubmenuState => Object.freeze({ status: "open", sub })
