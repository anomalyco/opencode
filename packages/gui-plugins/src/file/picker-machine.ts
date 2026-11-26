/** The most sessions whose filter the window remembers; the least recently changed go first. */
export const PICKER_MAX_SESSIONS = 40

/** How long an "Open file" focus request waits for its filter input to mount. */
export const PICKER_FOCUS_TIMEOUT_MS = 2_000

/** A session's file browser filter. `browsing` keeps the narrow-screen view on all files instead of a file tab. */
export type PickerFilter = { readonly text: string; readonly browsing: boolean }

/** The filter input a focus request is for. */
export type PickerFocusTarget =
  /** The side region's "Open file" launcher tab with this id. */
  | { readonly kind: "launcher"; readonly tabId: string }
  /** The narrow-screen file view while it browses all files. */
  | { readonly kind: "mobile" }

/** Moving keyboard focus to a filter input once it shows. */
export type PickerFocus =
  | { readonly status: "none" }
  | {
      readonly status: "requested"
      readonly request: number
      readonly sessionKey: string
      readonly target: PickerFocusTarget
    }

/** The window's file browser filters and its one pending focus request. `issued` is the last request id handed out. */
export type PickerState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly filters: Readonly<Record<string, PickerFilter>>
      readonly focus: PickerFocus
    }
  | { readonly status: "disposed" }

export type PickerEvent =
  /** "Open file" ran. A background open leaves keyboard focus where it is. */
  | {
      readonly type: "picker.opened"
      readonly sessionKey: string
      readonly query: string
      readonly target: PickerFocusTarget
      readonly background: boolean
    }
  | { readonly type: "filter.changed"; readonly sessionKey: string; readonly text: string }
  | { readonly type: "browsing.set"; readonly sessionKey: string; readonly browsing: boolean }
  /** A file tab opened, or the user selected one on a wide screen: the narrow-screen view shows it, not the browser. */
  | { readonly type: "file.opened"; readonly sessionKey: string }
  | { readonly type: "launcher.closed"; readonly sessionKey: string; readonly tabId: string }
  /** The filter input took the focus, or the request timed out. */
  | { readonly type: "focus.ended"; readonly request: number }
  | { readonly type: "disposed" }

export type PickerEffect =
  | { readonly type: "start-focus-timer"; readonly request: number; readonly timeoutMs: number }
  | { readonly type: "cancel-focus-timer" }

export type PickerTransition = { readonly state: PickerState; readonly effects: readonly PickerEffect[] }

/** Where a filter input shows. */
export type PickerView =
  | { readonly placement: "side"; readonly sessionKey: string; readonly tabId: string; readonly visible: boolean }
  | { readonly placement: "mobile"; readonly sessionKey: string; readonly browsing: boolean; readonly visible: boolean }

type Active = Extract<PickerState, { status: "active" }>

const NONE: readonly PickerEffect[] = []

const CANCEL: readonly PickerEffect[] = [{ type: "cancel-focus-timer" }]

// Fresh objects, never shared constants: the renderer keeps this state in a Solid store, which writes into the
// objects it holds.
export function createPickerState(): PickerState {
  return { status: "active", issued: 0, filters: {}, focus: noFocus() }
}

function noFocus(): PickerFocus {
  return { status: "none" }
}

export function transitionPicker(state: PickerState, event: PickerEvent): PickerTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.focus.status === "requested" ? CANCEL : NONE }

  if (event.type === "picker.opened") {
    const filters = patch(state.filters, event.sessionKey, { text: event.query, browsing: true })

    if (event.background)
      return update(state, filters, ownedBy(state.focus, event.sessionKey) ? noFocus() : state.focus)

    const request = state.issued + 1

    return {
      state: {
        status: "active",
        issued: request,
        filters,
        focus: { status: "requested", request, sessionKey: event.sessionKey, target: event.target },
      },
      effects: [{ type: "start-focus-timer", request, timeoutMs: PICKER_FOCUS_TIMEOUT_MS }],
    }
  }

  if (event.type === "filter.changed")
    return update(state, patch(state.filters, event.sessionKey, { text: event.text }), state.focus)

  if (event.type === "browsing.set") {
    const cancel = !event.browsing && ownedBy(state.focus, event.sessionKey) && state.focus.target.kind === "mobile"

    return update(
      state,
      patch(state.filters, event.sessionKey, { browsing: event.browsing }),
      cancel ? noFocus() : state.focus,
    )
  }

  if (event.type === "file.opened")
    return update(
      state,
      patch(state.filters, event.sessionKey, { browsing: false }),
      ownedBy(state.focus, event.sessionKey) ? noFocus() : state.focus,
    )

  if (event.type === "launcher.closed") {
    const cancel =
      ownedBy(state.focus, event.sessionKey) &&
      state.focus.target.kind === "launcher" &&
      state.focus.target.tabId === event.tabId

    return update(state, state.filters, cancel ? noFocus() : state.focus)
  }

  const ended = state.focus.status === "requested" && state.focus.request === event.request

  return update(state, state.filters, ended ? noFocus() : state.focus)
}

export function pickerFilterText(state: PickerState, sessionKey: string) {
  return state.status === "active" ? (state.filters[sessionKey]?.text ?? "") : ""
}

export function pickerBrowsing(state: PickerState, sessionKey: string) {
  return state.status === "active" ? (state.filters[sessionKey]?.browsing ?? false) : false
}

/** The focus request a filter input in this view should take, if any. */
export function pickerFocusRequest(state: PickerState, view: PickerView) {
  if (state.status !== "active" || state.focus.status !== "requested") return

  const focus = state.focus

  if (!view.visible || focus.sessionKey !== view.sessionKey) return

  if (focus.target.kind === "launcher")
    return view.placement === "side" && view.tabId === focus.target.tabId ? focus.request : undefined

  return view.placement === "mobile" && view.browsing ? focus.request : undefined
}

function ownedBy(focus: PickerFocus, sessionKey: string): focus is Extract<PickerFocus, { status: "requested" }> {
  return focus.status === "requested" && focus.sessionKey === sessionKey
}

function update(state: Active, filters: Active["filters"], focus: PickerFocus): PickerTransition {
  if (filters === state.filters && focus === state.focus) return { state, effects: NONE }

  return {
    state: { status: "active", issued: state.issued, filters, focus },
    effects: focus === state.focus ? NONE : CANCEL,
  }
}

/** Updates a session's filter as the newest entry, drops one with nothing to remember, and keeps the newest sessions. */
function patch(filters: Active["filters"], sessionKey: string, change: Partial<PickerFilter>) {
  const current = filters[sessionKey]
  const text = change.text ?? current?.text ?? ""
  const browsing = change.browsing ?? current?.browsing ?? false

  if (current?.text === text && current.browsing === browsing) return filters

  if (!current && !text && !browsing) return filters

  const rest = Object.entries(filters).filter(([key]) => key !== sessionKey)
  const kept = text || browsing ? [...rest, [sessionKey, { text, browsing }] as const] : rest

  return Object.fromEntries(kept.slice(Math.max(0, kept.length - PICKER_MAX_SESSIONS)))
}
