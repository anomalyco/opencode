export * as DeepLinks from "./index"

import type { BrowserWindow } from "electron"
import { consoleReturnWindow } from "../../shared/deep-links"
import { DeepLinkReceived } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { getLastFocusedWindow, getWindowByID } from "../windows"

export interface Interface {
  readonly receive: (urls: readonly string[]) => void
  /** The waiting links, which only the first renderer to ask receives. */
  readonly take: () => string[]
}

// Links wait, in the order they came, until a renderer takes them. Renderers take on startup and whenever main says
// more arrived, so a renderer that is still loading finds them too.
export function make(focus: (win: BrowserWindow | null) => void): Interface {
  const pending: string[] = []

  return {
    receive: (urls) => {
      const queued = urls.filter((url) => {
        const target = consoleReturnWindow(url)

        // A Console return only brings back the window that started the sign-in.
        if (target) focus(getWindowByID(target) ?? getLastFocusedWindow())

        return !target
      })

      if (queued.length === 0) return
      pending.push(...queued)
      const win = getLastFocusedWindow()
      focus(win)

      if (win) emitIpcEvent(win.webContents, new DeepLinkReceived())
    },
    take: () => pending.splice(0),
  }
}
