/**
 * The window's one terminal focus request. `pending` waits for a terminal being created; `target` waits for that
 * terminal to show and take focus. `request` is the last request handed out, so an answer for an older one is stale.
 * `overlay` marks a request started from a dialog or menu: closing it returns focus once, which does not cancel.
 */
export type FocusState =
  | { readonly status: "idle"; readonly request: number }
  | {
      readonly status: "pending"
      readonly request: number
      readonly session: string
      readonly overlay: boolean
    }
  | {
      readonly status: "target"
      readonly request: number
      readonly session: string
      readonly id: string
      readonly overlay: boolean
    }

export type FocusRequestEvent =
  /** A terminal is being created and should take focus once it exists. */
  | { readonly type: "request.pending"; readonly session: string; readonly overlay: boolean }
  /** A terminal should take focus once it shows. */
  | { readonly type: "request.target"; readonly session: string; readonly id: string; readonly overlay: boolean }
  | { readonly type: "pending.resolved"; readonly request: number; readonly id: string }
  | { readonly type: "pending.failed"; readonly request: number }
  /** The terminal took focus. */
  | { readonly type: "consumed"; readonly session: string; readonly id: string }
  /**
   * Focus moved: into the terminal or side panels (`panel`), into a field there such as a tab's rename field
   * (`field`), or anywhere else (`outside`). `leavingOverlay` is true when it left a dialog or menu, or nothing.
   */
  | { readonly type: "focus.moved"; readonly into: "panel" | "field" | "outside"; readonly leavingOverlay: boolean }
  /** The user pressed outside the panels and every dialog or menu. */
  | { readonly type: "pointer.outside" }
  /** Drops the request, or only one for `session`. */
  | { readonly type: "cancelled"; readonly session?: string }

export const initialFocusState: FocusState = { status: "idle", request: 0 }

/**
 * The user moving on cancels a request: focus or a press outside the panels, or into a field in them. The one focus
 * return of a closing dialog or menu that started the request does not.
 */
export function transitionFocus(state: FocusState, event: FocusRequestEvent): FocusState {
  if (event.type === "request.pending") {
    // A second new-terminal request joins the create in flight, so it keeps that create's request.
    if (state.status === "pending" && state.session === event.session)
      return event.overlay && !state.overlay ? { ...state, overlay: true } : state

    return { status: "pending", request: state.request + 1, session: event.session, overlay: event.overlay }
  }

  if (event.type === "request.target") {
    // Showing the tab asks again for the terminal already asked for; that keeps the request and its overlay.
    if (state.status === "target" && state.session === event.session && state.id === event.id)
      return event.overlay && !state.overlay ? { ...state, overlay: true } : state

    return {
      status: "target",
      request: state.request + 1,
      session: event.session,
      id: event.id,
      overlay: event.overlay,
    }
  }

  if (event.type === "pending.resolved")
    return state.status === "pending" && state.request === event.request
      ? { status: "target", request: state.request, session: state.session, id: event.id, overlay: state.overlay }
      : state

  if (event.type === "pending.failed")
    return state.status === "pending" && state.request === event.request ? idle(state) : state

  if (state.status === "idle") return state

  if (event.type === "consumed")
    return state.status === "target" && state.session === event.session && state.id === event.id ? idle(state) : state

  if (event.type === "focus.moved") {
    // The side region focuses its selected tab trigger or root while switching tabs.
    if (event.into === "panel") return state

    if (event.into === "outside" && state.overlay && event.leavingOverlay) return { ...state, overlay: false }

    return idle(state)
  }

  if (event.type === "pointer.outside") return idle(state)

  return event.session === undefined || event.session === state.session ? idle(state) : state
}

export function hasFocusRequest(state: FocusState) {
  return state.status !== "idle"
}

export function isFocusRequested(state: FocusState, session: string, id: string) {
  return state.status === "target" && state.session === session && state.id === id
}

/** The request asking `id` to take focus, so a focus attempt runs once per request. */
export function focusRequestToken(state: FocusState, session: string, id: string) {
  return isFocusRequested(state, session, id) ? state.request : undefined
}

function idle(state: FocusState): FocusState {
  return { status: "idle", request: state.request }
}
