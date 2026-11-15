import type { Browser } from "@opencode/plugin-browser/rpc"
import { destinationOrigin } from "./policy"

// The document a browser page shows, folded from Electron's navigation events. Electron-free so it stays
// unit-testable under Bun.

type Document = {
  /** Bumped when a navigation replaces the document; refs and operations from an older one are stale. */
  readonly generation: number
  readonly url: string
  /**
   * Chromium names a document after its URL until its <title> parses. A navigation on the same site keeps the shown
   * title until the new document names itself or stops loading, so a page that reloads or redirects to itself does
   * not flash its URL in the tab strip.
   */
  readonly title: string
  /** The committed document's origin; its icon stays while navigations remain on it. */
  readonly origin: string
  readonly icon: string | undefined
  /** Bumped by every icon change, so a slow fetch for an earlier icon cannot replace a later one. */
  readonly iconAttempt: number
  /**
   * The main-frame navigation that started and has not committed, failed, or stopped. Downloads, blocked links and
   * cancelled loads start a navigation that never commits, so the document stays.
   */
  readonly pending: string | undefined
  /** Between Chromium's did-start-loading and did-stop-loading, subframes included. */
  readonly busy: boolean
}

export type DocumentState =
  /** A blank document: never shown, so its load does not count as loading and a new tab shows its new tab page. */
  | (Document & { readonly status: "blank" })
  /** A restored tab before its first navigation settles; that navigation consumes the generation it reserved. */
  | (Document & { readonly status: "restoring" })
  /**
   * A real document. Chromium keeps the previous document painted until the next one renders, so a revealed page
   * stays revealed through later navigations; a page that follows a blank or failed one waits for dom-ready.
   */
  | (Document & { readonly status: "loaded"; readonly revealed: boolean })
  /** A failed load: Chromium's error page or the proxy's empty 502, which the window replaces with its own. */
  | (Document & { readonly status: "failed"; readonly message: string })
  | { readonly status: "closed" }

export type DocumentEvent =
  | { readonly type: "loading.started" }
  | { readonly type: "loading.stopped"; readonly title: string }
  | {
      readonly type: "navigation.started"
      readonly url: string
      readonly isMainFrame: boolean
      readonly isSameDocument: boolean
    }
  /** Electron's did-navigate: a main-frame document committed. */
  | {
      readonly type: "navigation.committed"
      readonly url: string
      readonly status: number
      readonly statusText: string
      readonly title: string
    }
  | {
      readonly type: "navigation.failed"
      readonly code: number
      readonly description: string
      readonly url: string
      readonly isMainFrame: boolean
    }
  | { readonly type: "navigation.in-page"; readonly url: string; readonly title: string; readonly isMainFrame: boolean }
  | { readonly type: "document.ready" }
  | { readonly type: "title.updated"; readonly title: string }
  | { readonly type: "icon.updated"; readonly favicons: readonly string[] }
  | { readonly type: "icon.loaded"; readonly attempt: number; readonly icon: string | undefined }
  | { readonly type: "disposed" }

export type DocumentEffect =
  /** A new document replaced the old one: forget its frames, snapshot refs and picked elements, and end the picker. */
  | { readonly type: "reset-document" }
  /** A main-frame navigation started: console and network entries restart with it, its own request included. */
  | { readonly type: "clear-diagnostics" }
  | { readonly type: "show"; readonly visible: boolean }
  | { readonly type: "publish" }
  /** Reports the icon and zoom; Chromium keeps a zoom per origin, so a new document may have its own. */
  | { readonly type: "detail" }
  | { readonly type: "load-icon"; readonly attempt: number; readonly favicons: readonly string[] }

export type DocumentTransition = { readonly state: DocumentState; readonly effects: readonly DocumentEffect[] }

type Open = Exclude<DocumentState, { status: "closed" }>

const CLOSED: DocumentState = { status: "closed" }

const RESET: DocumentEffect = { type: "reset-document" }

const CLEAR: DocumentEffect = { type: "clear-diagnostics" }

const PUBLISH: DocumentEffect = { type: "publish" }

const DETAIL: DocumentEffect = { type: "detail" }

export function createDocumentState(restore?: { url: string; title: string; generation: number }): DocumentState {
  const document = {
    url: "about:blank",
    title: "",
    origin: "",
    icon: undefined,
    iconAttempt: 0,
    pending: undefined,
    busy: false,
  }

  if (restore)
    return {
      ...document,
      status: "restoring",
      url: restore.url || "about:blank",
      title: restore.title,
      generation: restore.generation,
    }

  return { ...document, status: "blank", generation: 0 }
}

export function transitionDocument(state: DocumentState, event: DocumentEvent): DocumentTransition {
  if (state.status === "closed") return unchanged(state)

  switch (event.type) {
    case "disposed":
      return { state: CLOSED, effects: [] }
    case "loading.started":
      return state.busy ? unchanged(state) : settle(state, { ...state, busy: true }, [])
    case "loading.stopped":
      return stopped(state, event.title)
    case "navigation.started":
      if (!event.isMainFrame || event.isSameDocument) return unchanged(state)

      return settle(state, { ...state, pending: event.url }, [CLEAR, PUBLISH])
    case "navigation.committed":
      return committed(state, event)
    case "navigation.failed":
      return failed(state, event)
    case "navigation.in-page":
      if (!event.isMainFrame) return unchanged(state)

      return settle(
        state,
        state.status === "loaded" ? { ...state, url: event.url, title: event.title } : { ...state, title: event.title },
        [PUBLISH],
      )
    case "document.ready":
      return state.status === "loaded" && !state.revealed
        ? settle(state, { ...state, revealed: true }, [])
        : unchanged(state)
    case "title.updated":
      return event.title === state.title ? unchanged(state) : settle(state, { ...state, title: event.title }, [PUBLISH])
    case "icon.updated": {
      const attempt = state.iconAttempt + 1

      return {
        state: { ...state, iconAttempt: attempt },
        effects: [{ type: "load-icon", attempt, favicons: event.favicons }],
      }
    }

    case "icon.loaded":
      if (event.attempt !== state.iconAttempt || event.icon === state.icon) return unchanged(state)

      return { state: { ...state, icon: event.icon }, effects: [DETAIL] }
  }
}

export function isDocumentClosed(state: DocumentState) {
  return state.status === "closed"
}

export function documentGeneration(state: DocumentState) {
  return state.status === "closed" ? 0 : state.generation
}

/** Whether the native surface holds a document worth exposing over the themed background. */
export function documentVisible(state: DocumentState) {
  return state.status === "loaded" && state.revealed
}

export function documentIcon(state: DocumentState) {
  return state.status === "closed" ? undefined : state.icon
}

/** A blank document's load is not shown as loading; a navigation away from it is. */
export function isDocumentLoading(state: DocumentState) {
  if (state.status === "closed" || !state.busy) return false

  if (state.pending !== undefined) return state.pending !== "about:blank"

  return state.status === "loaded"
}

export function documentTab(
  state: DocumentState,
  history: { readonly id: Browser.TabID; readonly canGoBack: boolean; readonly canGoForward: boolean },
): Browser.Tab {
  if (state.status === "closed") return { ...history, url: "", title: "", loading: false, generation: 0 }

  const loading = isDocumentLoading(state)

  const tab = {
    id: history.id,
    url: state.url.slice(0, 16_384),
    title: state.title.slice(0, 2_048),
    loading,
    canGoBack: history.canGoBack,
    canGoForward: history.canGoForward,
    generation: state.generation,
  }

  // A reload of a failed page shows its progress, and the error again if it stops without a document.
  return state.status === "failed" && !loading ? { ...tab, loadError: state.message } : tab
}

function committed(state: Open, event: Extract<DocumentEvent, { type: "navigation.committed" }>): DocumentTransition {
  // Another site's icon arrives with its document; the same site keeps its icon meanwhile, as tabs do. Files and blank
  // pages have no shared origin, so each keeps none.
  const origin = destinationOrigin(event.url) ?? event.url
  const same = origin === state.origin

  const document = {
    generation: state.status === "restoring" ? state.generation : state.generation + 1,
    url: event.url,
    title: same ? state.title : event.title,
    origin,
    icon: same ? state.icon : undefined,
    iconAttempt: same ? state.iconAttempt : state.iconAttempt + 1,
    pending: undefined,
    busy: state.busy,
  }

  const next: Open =
    event.url === "about:blank"
      ? { ...document, status: "blank" }
      : // The server-network proxy answers an unreachable HTTP target with an empty 502. Other error statuses are
        // real documents from the user's server and stay visible.
        event.status === 502
        ? { ...document, status: "failed", message: `${event.status} ${event.statusText}`.trim().slice(0, 2_048) }
        : { ...document, status: "loaded", revealed: documentVisible(state) }

  return settle(state, next, [RESET, PUBLISH, DETAIL])
}

function failed(state: Open, event: Extract<DocumentEvent, { type: "navigation.failed" }>): DocumentTransition {
  // Cancelled navigations and failed subframes do not replace the current page.
  if (!event.isMainFrame || event.code === -3) return unchanged(state)

  // A failure with a navigation in flight commits an error page in place of the document. One without, after the
  // document committed, fails that document, which keeps its generation.
  const replaced = state.pending !== undefined || state.status === "restoring"

  const next: Open = {
    status: "failed",
    generation: replaced && state.status !== "restoring" ? state.generation + 1 : state.generation,
    url: event.url,
    title: state.title,
    origin: state.origin,
    icon: state.icon,
    iconAttempt: state.iconAttempt,
    pending: undefined,
    busy: state.busy,
    message: event.description.slice(0, 2_048),
  }

  return settle(state, next, replaced ? [RESET, PUBLISH] : [PUBLISH])
}

function stopped(state: Open, title: string): DocumentTransition {
  const document = { title, pending: undefined, busy: false }

  // A restore whose navigation never committed, such as a download, leaves the blank document it started on.
  if (state.status === "restoring")
    return settle(state, { ...state, ...document, status: "blank", url: "about:blank" }, [PUBLISH])

  return settle(
    state,
    state.status === "loaded" ? { ...state, ...document, revealed: true } : { ...state, ...document },
    [PUBLISH],
  )
}

/** Adds the effects a change implies: showing or hiding the surface, and publishing a change of loading. */
function settle(previous: Open, next: Open, effects: readonly DocumentEffect[]): DocumentTransition {
  const visible = documentVisible(next)
  const shown: readonly DocumentEffect[] = visible === documentVisible(previous) ? [] : [{ type: "show", visible }]
  const publish = isDocumentLoading(next) !== isDocumentLoading(previous) && !effects.includes(PUBLISH)

  return { state: next, effects: [...shown, ...effects, ...(publish ? [PUBLISH] : [])] }
}

function unchanged(state: DocumentState): DocumentTransition {
  return { state, effects: [] }
}
