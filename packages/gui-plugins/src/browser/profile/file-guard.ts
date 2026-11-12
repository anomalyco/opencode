import { app, type Session, type WebContents } from "electron"
import { initialFileGuard, transitionFileGuard, type FileGuardEvent } from "./file-guard-machine"

/**
 * Drives the guard for every page of `session`, from before its first navigation: popups, extension pages and the
 * pane's own tabs alike. `allowed` decides each `file:` request while the guard is on. Returns the stop.
 */
export function createFileGuard(input: {
  session: Session
  allowed: (request: Electron.OnBeforeRequestListenerDetails) => boolean
}) {
  const state = { current: initialFileGuard }

  const listener = (
    request: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.CallbackResponse) => void,
  ) => callback({ cancel: !input.allowed(request) })

  const dispatch = (event: FileGuardEvent) => {
    const previous = state.current
    state.current = transitionFileGuard(previous, event)

    if (state.current.on === previous.on) return
    input.session.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, state.current.on ? listener : null)
  }

  const frames = (contents: WebContents) =>
    contents.isDestroyed() ? [] : contents.mainFrame.framesInSubtree.map((frame) => frame.processId)

  const watch = (contents: WebContents) => {
    const id = contents.id
    contents.on("did-start-navigation", (event) => dispatch({ type: "navigation.started", contents: id, url: event.url }))
    contents.on("did-frame-navigate", (_event, url, _code, _status, _main, process) =>
      dispatch({ type: "frame.committed", contents: id, url, process }),
    )
    contents.on("did-stop-loading", () => dispatch({ type: "loading.stopped", contents: id, frames: frames(contents) }))
    contents.once("destroyed", () => dispatch({ type: "destroyed", contents: id }))
  }

  const created = (_event: Electron.Event, contents: WebContents) => {
    if (contents.session === input.session) watch(contents)
  }

  app.on("web-contents-created", created)

  return () => {
    app.off("web-contents-created", created)
    input.session.webRequest.onBeforeRequest(null)
  }
}
