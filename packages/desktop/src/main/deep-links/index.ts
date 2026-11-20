export * as DeepLinks from "./index"

import type { BrowserWindow } from "electron"
import { consoleReturnWindow } from "../../shared/deep-links"
import { DeepLinkReceived } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { getLastFocusedWindow, getWindowByID } from "../windows"
import { takeLaunchDeepLink } from "./launch"

export interface Interface {
  readonly receive: (url: string) => void
  /** The waiting link, which only the first renderer to ask receives. */
  readonly take: () => string | undefined
}

// One link waits until a renderer takes it, starting with the one the app launched with. A newer link replaces
// one not yet taken. Renderers take on startup and whenever main says one arrived, so a renderer that is still
// loading finds it too.
export function make(focus: (win: BrowserWindow | null) => void): Interface {
  let pending = takeLaunchDeepLink()

  return {
    receive: (url) => {
      const target = consoleReturnWindow(url)

      // A Console return only brings back the window that started the sign-in.
      if (target) return focus(getWindowByID(target) ?? getLastFocusedWindow())
      pending = url
      const win = getLastFocusedWindow()
      focus(win)

      if (win) emitIpcEvent(win.webContents, new DeepLinkReceived())
    },
    take: () => {
      const url = pending
      pending = undefined

      return url
    },
  }
}
