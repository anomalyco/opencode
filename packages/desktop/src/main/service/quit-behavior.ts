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
  // Someone who chose in Settings already knows; the first-quit notice has nothing to add.
  getStore().set(SERVICE_QUIT_NOTICE_SHOWN_KEY, true)
}

/** The first quit tells the user that the service keeps running, and where to change that. */
export function isQuitNoticePending() {
  return getStore().get(SERVICE_QUIT_NOTICE_SHOWN_KEY) !== true
}

/** Shown once; the quit continues whatever the user does with it. */
export async function showQuitNotice() {
  const win = getLastFocusedWindow()

  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: [nativeT("desktop.quit.serviceNotice.ok")],
    defaultId: 0,
    cancelId: 0,
    message: nativeT("desktop.quit.serviceNotice.message"),
    detail: nativeT("desktop.quit.serviceNotice.detail"),
  }

  // The last window is already closed when closing it quits the app (Windows, Linux), so the dialog may have no parent.
  await (win && win.isVisible() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
  getStore().set(SERVICE_QUIT_NOTICE_SHOWN_KEY, true)
}
