export * as QuitBehavior from "./quit-behavior"

import { dialog } from "electron"
import { KEEP_SERVICE_RUNNING_KEY, SERVICE_QUIT_NOTICE_SHOWN_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import { nativeT } from "../native/translations"
import { getLastFocusedWindow } from "../windows"

/** The background service outlives the app unless the user turned that off. */
export function getKeepServiceRunning() {
  return getStore().get(KEEP_SERVICE_RUNNING_KEY) !== false
}

export function setKeepServiceRunning(enabled: boolean) {
  getStore().set(KEEP_SERVICE_RUNNING_KEY, enabled)
  // Choosing in Settings answers the first-quit question too.
  getStore().set(SERVICE_QUIT_NOTICE_SHOWN_KEY, true)
}

/** The first quit explains that the service keeps running, and offers to stop it instead. */
export function isQuitNoticePending() {
  return getStore().get(SERVICE_QUIT_NOTICE_SHOWN_KEY) !== true
}

const KEEP = 0

const STOP = 1

/** Asks once and stores the answer. Dismissing the dialog keeps the default: the service keeps running. */
export async function confirmFirstQuit() {
  const win = getLastFocusedWindow()

  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [nativeT("desktop.quit.serviceNotice.keepRunning"), nativeT("desktop.quit.serviceNotice.stopOnQuit")],
    defaultId: KEEP,
    cancelId: KEEP,
    message: nativeT("desktop.quit.serviceNotice.message"),
    detail: nativeT("desktop.quit.serviceNotice.detail"),
  }

  // The last window is already closed when closing it quits the app (Windows, Linux), so the dialog may have no parent.
  const { response } = await (win && win.isVisible()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options))

  setKeepServiceRunning(response !== STOP)
}
