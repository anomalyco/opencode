export * as Toasts from "./index"

import { app, BrowserWindow, Notification, type WebContents } from "electron"
import { ToastActivated } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { focusWindow, showWindow } from "../windows/focus"

export type ToastInput = { readonly title: string; readonly body: string }

// Windows toasts by tag (a tag names its server too), so any window's answer takes one back. Main posts them, not
// the page: only a main-process notification's `close()` takes it out of the notification center after it timed out
// there (electron/electron#32260), and each must stay referenced while Windows shows it.
const posted = new Map<string, Notification>()

const MAX_POSTED = 40

/** Posts a toast for `sender`, replacing the earlier toast with the same tag. A click brings the window forward. */
export function show(sender: WebContents, tag: string, input: ToastInput) {
  dismiss(tag)
  const notification = new Notification({ title: input.title, body: input.body, silent: true })

  notification.on("click", () => {
    if (posted.get(tag) === notification) posted.delete(tag)

    if (sender.isDestroyed()) return
    const win = BrowserWindow.fromWebContents(sender)
    showWindow(win)
    focusWindow(win, app)
    emitIpcEvent(sender, new ToastActivated({ tag }))
  })

  if (posted.size >= MAX_POSTED) {
    const oldest = posted.keys().next().value

    if (oldest) dismiss(oldest)
  }

  posted.set(tag, notification)
  notification.show()
}

export function dismiss(tag: string) {
  posted.get(tag)?.close()
  posted.delete(tag)
}
