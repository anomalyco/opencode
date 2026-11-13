import { app, type Session, type WebContents } from "electron"
import { fileRequestCancelled, initialFileGuard, transitionFileGuard, type FileGuardEvent } from "./file-guard-machine"

/**
 * Drives the guard for every page of `session`, from before its first navigation: popups, extension pages and the
 * pane's own tabs alike. `allowed` decides each `file:` request while the guard is on. Returns the stop, which
 * removes every listener the guard added; a stopped guard never changes the session's request listener again.
 */
export function createFileGuard(input: {
  session: Session
  allowed: (request: Electron.OnBeforeRequestListenerDetails) => boolean
}) {
  const state = { current: initialFileGuard, stopped: false }
  // Each watched page's listeners, removed when the page goes or the guard stops.
  const watched = new Map<WebContents, () => void>()

  const listener = (
    request: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.CallbackResponse) => void,
  ) => callback({ cancel: fileRequestCancelled(() => input.allowed(request)) })

  const dispatch = (event: FileGuardEvent) => {
    if (state.stopped) return
    const previous = state.current
    state.current = transitionFileGuard(previous, event)

    if (state.current.on === previous.on) return
    input.session.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, state.current.on ? listener : null)
  }

  const frames = (contents: WebContents) =>
    contents.isDestroyed() ? [] : contents.mainFrame.framesInSubtree.map((frame) => frame.processId)

  const watch = (contents: WebContents) => {
    const id = contents.id

    const started = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) =>
      dispatch({ type: "navigation.started", contents: id, url: event.url })

    const committed = (
      _event: Electron.Event,
      url: string,
      _code: number,
      _status: string,
      _main: boolean,
      process: number,
    ) => dispatch({ type: "frame.committed", contents: id, url, process })

    const stopped = () => dispatch({ type: "loading.stopped", contents: id, frames: frames(contents) })

    const destroyed = () => {
      watched.delete(contents)
      dispatch({ type: "destroyed", contents: id })
    }

    contents.on("did-start-navigation", started)
    contents.on("did-frame-navigate", committed)
    contents.on("did-stop-loading", stopped)
    contents.once("destroyed", destroyed)
    watched.set(contents, () => {
      if (contents.isDestroyed()) return
      contents.off("did-start-navigation", started)
      contents.off("did-frame-navigate", committed)
      contents.off("did-stop-loading", stopped)
      contents.off("destroyed", destroyed)
    })
  }

  const created = (_event: Electron.Event, contents: WebContents) => {
    if (contents.session === input.session) watch(contents)
  }

  app.on("web-contents-created", created)

  return () => {
    if (state.stopped) return
    state.stopped = true
    app.off("web-contents-created", created)
    watched.forEach((off) => off())
    watched.clear()

    // Only a guard that holds the session's listener removes it, so it never removes a later guard's.
    if (state.current.on) input.session.webRequest.onBeforeRequest(null)
  }
}
