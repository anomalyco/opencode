export * as DeepLinks from "./index"

import type { BrowserWindow } from "electron"
import { Effect } from "effect"
import { DeepLinksOpened } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { getWindowByID, onMainWindow } from "../windows"
import { createDeepLinkState, transitionDeepLinks, type DeepLinkEvent } from "./machine"

export interface Interface {
  readonly receive: (urls: readonly string[]) => void
  readonly ready: (windowID: string, clientID: number) => void
  readonly acknowledge: (clientID: number, attempt: number) => void
  readonly disconnect: (clientID: number) => void
}

/** Routes deep links to app windows through the delivery machine for as long as the caller's scope lives. */
export const make = Effect.fn("DeepLinks.make")(function* (focus: (win: BrowserWindow | null) => void) {
  let state = createDeepLinkState()

  const dispatch = (event: DeepLinkEvent): void => {
    const next = transitionDeepLinks(state, event)
    // Commit before running commands: focusing a window dispatches its focus event synchronously.
    state = next.state
    next.commands.forEach((command) => {
      if (command.type === "window.focus") return focus(getWindowByID(command.windowID))
      const win = getWindowByID(command.windowID)
      const opened = new DeepLinksOpened({ attempt: command.attempt, urls: command.urls })
      const sent = !!win && emitIpcEvent(win.webContents, opened)

      // A renderer without an event stream is gone, so its links wait for the next one.
      if (!sent) dispatch({ type: "client.disconnected", clientID: command.clientID })
    })
  }

  const stop = onMainWindow((win, windowID) => {
    dispatch({ type: "window.opened", windowID })

    if (win.isFocused()) dispatch({ type: "window.focused", windowID })
    win.on("focus", () => dispatch({ type: "window.focused", windowID }))
    win.once("closed", () => dispatch({ type: "window.closed", windowID }))
  })

  yield* Effect.addFinalizer(() => Effect.sync(stop))

  return {
    receive: (urls) => dispatch({ type: "links.received", urls }),
    ready: (windowID, clientID) => dispatch({ type: "window.ready", windowID, clientID }),
    acknowledge: (clientID, attempt) => dispatch({ type: "delivery.acknowledged", clientID, attempt }),
    disconnect: (clientID) => dispatch({ type: "client.disconnected", clientID }),
  } satisfies Interface
})
