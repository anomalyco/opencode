import type { Browser } from "@opencode/plugin-browser/rpc"
import type { PaneElement } from "./ipc"

// What the browser pane lays over its page: the element picker, a comment on a picked element, or a note on the whole
// page. One at a time, each owned by the session and tab it started on. The picker shows as on only once main says it
// is, so a request main never answers cannot leave the button pressed or the window swallowing Escape.

export type OverlayState =
  | { readonly status: "idle" }
  | { readonly status: "picking"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  /** A picked element awaiting its comment. The page stays frozen as a still until it closes. */
  | {
      readonly status: "commenting"
      readonly sessionKey: string
      readonly tabID: Browser.TabID
      readonly url: string
      /** The tab's navigation count at the pick; the element's ref dies when it changes. */
      readonly generation: number
      readonly element: PaneElement
      readonly draft: string
      readonly editorHeight: number
      /** Opening measurement, frozen so typing never chooses a different side of the element. */
      readonly editorInitialHeight: number
    }
  /** A comment on the whole page awaiting its text, frozen like an element comment. */
  | {
      readonly status: "noting"
      readonly sessionKey: string
      readonly tabID: Browser.TabID
      readonly url: string
      readonly title: string
      readonly draft: string
    }

/** The tab the pane shows, as a handler reads it when the event happens. */
export type OverlayTab = {
  readonly id: Browser.TabID
  readonly url: string
  readonly title: string
  readonly generation: number
}

/** Where the pane is: the routed session, its shown tab, and whether that page can be picked from. */
export type OverlayContext = {
  readonly sessionKey: string
  readonly tab: OverlayTab | undefined
  readonly visible: boolean
  readonly inspectable: boolean
}

export type OverlayEvent =
  /** The Inspect button or shortcut. */
  | { readonly type: "picker.toggled"; readonly context: OverlayContext }
  /** Main reports the picker of a session's tab starting, stopping, or picking an element. */
  | {
      readonly type: "inspect.reported"
      readonly sessionKey: string
      readonly tabID: Browser.TabID
      readonly active: boolean
      readonly element?: PaneElement
      readonly context: OverlayContext
    }
  /** "Add page to session". */
  | { readonly type: "note.opened"; readonly context: OverlayContext }
  | { readonly type: "draft.changed"; readonly value: string }
  | { readonly type: "editor.resized"; readonly height: number }
  | { readonly type: "escape.pressed" }
  | { readonly type: "overlay.cancelled" }
  /** A press beside the editor: it dismisses only an empty draft. */
  | { readonly type: "backdrop.pressed" }
  | { readonly type: "overlay.submitted"; readonly value: string; readonly context: OverlayContext }
  /** The routed session, the shown tab, the pane's visibility or the page's inspectability changed. */
  | { readonly type: "context.changed"; readonly context: OverlayContext }
  | { readonly type: "disposed" }

export type OverlayEffect =
  | {
      readonly type: "set-inspect"
      readonly sessionKey: string
      readonly tabID: Browser.TabID
      readonly enabled: boolean
    }
  | { readonly type: "clear-highlight"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  | {
      readonly type: "attach-comment"
      readonly tabID: Browser.TabID
      readonly url: string
      readonly element: PaneElement
      /** False once the tab navigated: the draft survives, but its ref names nothing. */
      readonly live: boolean
      readonly comment: string
    }
  | {
      readonly type: "attach-note"
      readonly tabID: Browser.TabID
      readonly url: string
      readonly title: string
      readonly comment: string
    }

export type OverlayTransition = { readonly state: OverlayState; readonly effects: readonly OverlayEffect[] }

export const initialOverlayState: OverlayState = { status: "idle" }

const IDLE: OverlayState = initialOverlayState

export function transitionOverlay(state: OverlayState, event: OverlayEvent): OverlayTransition {
  switch (event.type) {
    case "picker.toggled": {
      const tab = event.context.tab

      if (!tab || !event.context.inspectable) return unchanged(state)

      if (owns(state, "picking", event.context.sessionKey, tab.id))
        return { state: IDLE, effects: [inspect(event.context.sessionKey, tab.id, false)] }

      // Stays idle until main confirms the picker started.
      return { state: IDLE, effects: [...cleanup(state), inspect(event.context.sessionKey, tab.id, true)] }
    }

    case "inspect.reported":
      return reported(state, event)
    case "note.opened": {
      const tab = event.context.tab

      if (!tab || !tab.url || tab.url === "about:blank") return unchanged(state)

      // The editor is already open: the button keeps what the user wrote.
      if (owns(state, "noting", event.context.sessionKey, tab.id)) return unchanged(state)

      return {
        state: {
          status: "noting",
          sessionKey: event.context.sessionKey,
          tabID: tab.id,
          url: tab.url,
          title: tab.title,
          draft: "",
        },
        effects: cleanup(state),
      }
    }

    case "draft.changed":
      if ((state.status !== "commenting" && state.status !== "noting") || state.draft === event.value)
        return unchanged(state)

      return { state: { ...state, draft: event.value }, effects: [] }
    case "editor.resized": {
      if (state.status !== "commenting") return unchanged(state)
      const height = Math.ceil(event.height)
      const initial = state.editorInitialHeight || height

      if (height === state.editorHeight && initial === state.editorInitialHeight) return unchanged(state)

      return { state: { ...state, editorHeight: height, editorInitialHeight: initial }, effects: [] }
    }

    case "escape.pressed":
      return state.status === "picking" ? close(state) : unchanged(state)
    case "overlay.cancelled":
      return state.status === "commenting" || state.status === "noting" ? close(state) : unchanged(state)
    case "backdrop.pressed":
      if (state.status !== "commenting" && state.status !== "noting") return unchanged(state)

      return state.draft.trim() ? unchanged(state) : close(state)
    case "overlay.submitted":
      return submitted(state, event.value, event.context)
    case "context.changed":
      return changed(state, event.context)
    case "disposed":
      return state.status === "idle" ? unchanged(state) : close(state)
  }
}

/** What the pane draws for the session and tab it shows. */
export function overlayView(state: OverlayState, sessionKey: string, tabID: Browser.TabID | undefined) {
  const mine =
    tabID !== undefined && state.status !== "idle" && state.sessionKey === sessionKey && state.tabID === tabID

  const picking = mine && state.status === "picking"
  const commenting = mine && state.status === "commenting"
  const noting = mine && state.status === "noting"

  return {
    picking,
    /** A comment or note freezes the page so its editor can float above it. */
    frozen: commenting || noting,
    /** The Inspect button keeps its accent while the picked element's comment is open. */
    accent: picking || commenting,
  }
}

/** The element comment the pane shows, when it belongs to the session and tab on screen. */
export function overlayComment(state: OverlayState, sessionKey: string, tabID: Browser.TabID | undefined) {
  return state.status === "commenting" && state.sessionKey === sessionKey && state.tabID === tabID ? state : undefined
}

/** The page note the pane shows, when it belongs to the session and tab on screen. */
export function overlayNote(state: OverlayState, sessionKey: string, tabID: Browser.TabID | undefined) {
  return state.status === "noting" && state.sessionKey === sessionKey && state.tabID === tabID ? state : undefined
}

/** The window takes Escape from the app only while the picker it shows waits for a click in the page. */
export function capturesEscape(state: OverlayState) {
  return state.status === "picking"
}

function reported(state: OverlayState, event: Extract<OverlayEvent, { type: "inspect.reported" }>): OverlayTransition {
  const context = event.context
  const shown = context.sessionKey === event.sessionKey && context.tab?.id === event.tabID && context.visible
  const stopped = owns(state, "picking", event.sessionKey, event.tabID) ? IDLE : state

  if (event.active) {
    // A picker on a page the user no longer sees, or cannot pick from, stops again.
    if (!shown || !context.inspectable) return { state, effects: [inspect(event.sessionKey, event.tabID, false)] }

    if (owns(state, "picking", event.sessionKey, event.tabID)) return unchanged(state)

    return {
      state: { status: "picking", sessionKey: event.sessionKey, tabID: event.tabID },
      effects: cleanup(state),
    }
  }

  if (!event.element) return stopped === state ? unchanged(state) : { state: stopped, effects: [] }

  // A pick on a page that is no longer shown keeps no comment, and its highlight goes.
  if (!shown || !context.tab)
    return { state: stopped, effects: [{ type: "clear-highlight", sessionKey: event.sessionKey, tabID: event.tabID }] }

  // The new pick replaces what this page had, and its highlight replaces the old one; another page's picker stops and
  // its highlight goes.
  const elsewhere = state.status !== "idle" && (state.sessionKey !== event.sessionKey || state.tabID !== event.tabID)

  return {
    state: {
      status: "commenting",
      sessionKey: event.sessionKey,
      tabID: event.tabID,
      url: context.tab.url,
      generation: context.tab.generation,
      element: event.element,
      draft: "",
      editorHeight: 0,
      editorInitialHeight: 0,
    },
    effects: elsewhere ? cleanup(state) : [],
  }
}

function submitted(state: OverlayState, value: string, context: OverlayContext): OverlayTransition {
  if (state.status === "commenting") {
    const live =
      context.sessionKey === state.sessionKey &&
      context.tab?.id === state.tabID &&
      context.tab.generation === state.generation

    return {
      state: IDLE,
      effects: [
        { type: "attach-comment", tabID: state.tabID, url: state.url, element: state.element, live, comment: value },
        { type: "clear-highlight", sessionKey: state.sessionKey, tabID: state.tabID },
      ],
    }
  }

  if (state.status !== "noting") return unchanged(state)

  return {
    state: IDLE,
    effects: [{ type: "attach-note", tabID: state.tabID, url: state.url, title: state.title, comment: value }],
  }
}

/**
 * The picker belongs to the page on screen: it stops when its tab is switched away, the pane hides, or the page can no
 * longer be picked from. A comment or note closes with its tab and keeps its draft through a reload.
 */
function changed(state: OverlayState, context: OverlayContext): OverlayTransition {
  if (state.status === "idle") return unchanged(state)
  const same = state.sessionKey === context.sessionKey && state.tabID === context.tab?.id

  if (state.status === "picking")
    return same && context.visible && context.inspectable ? unchanged(state) : close(state)

  return same ? unchanged(state) : close(state)
}

function close(state: OverlayState): OverlayTransition {
  return { state: IDLE, effects: cleanup(state) }
}

/** What leaving a phase tells main: the picker stops, and a comment's highlight goes. */
function cleanup(state: OverlayState): readonly OverlayEffect[] {
  if (state.status === "picking") return [inspect(state.sessionKey, state.tabID, false)]

  if (state.status === "commenting")
    return [{ type: "clear-highlight", sessionKey: state.sessionKey, tabID: state.tabID }]

  return []
}

function owns(state: OverlayState, status: "picking" | "noting", sessionKey: string, tabID: Browser.TabID) {
  return state.status === status && state.sessionKey === sessionKey && state.tabID === tabID
}

function inspect(sessionKey: string, tabID: Browser.TabID, enabled: boolean): OverlayEffect {
  return { type: "set-inspect", sessionKey, tabID, enabled }
}

function unchanged(state: OverlayState): OverlayTransition {
  return { state, effects: [] }
}
