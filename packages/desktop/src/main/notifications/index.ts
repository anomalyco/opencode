export * as Toasts from "./index"

import { app, BrowserWindow, Notification, type WebContents } from "electron"
import { ToastActivated } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { focusWindow, showWindow } from "../windows/focus"

export type ToastInput = { readonly title: string; readonly body: string }

// Windows toasts by window and tag. Main posts them, not the page: only a main-process notification's `close()`
// takes it out of the notification center after it timed out there (electron/electron#32260), and each must stay
// referenced while Windows shows it.
const posted = new Map<string, Notification>()

const MAX_POSTED = 40

/** Posts a toast for `sender`, replacing its earlier toast with the same tag. A click brings the window forward. */
export function show(sender: WebContents, tag: string, input: ToastInput) {
  dismiss(sender, tag)
  const key = toastKey(sender, tag)
  const notification = new Notification({ title: input.title, body: input.body, silent: true })

  notification.on("click", () => {
    posted.delete(key)

    if (sender.isDestroyed()) return
    const win = BrowserWindow.fromWebContents(sender)
    showWindow(win)
    focusWindow(win, app)
    emitIpcEvent(sender, new ToastActivated({ tag }))
  })

  if (posted.size >= MAX_POSTED) {
    const oldest = posted.keys().next().value

    if (oldest) posted.delete(oldest)
  }

  posted.set(key, notification)
  notification.show()
}

export function dismiss(sender: WebContents, tag: string) {
  const key = toastKey(sender, tag)
  posted.get(key)?.close()
  posted.delete(key)
}

function toastKey(sender: WebContents, tag: string) {
  return `${sender.id}\0${tag}`
}
