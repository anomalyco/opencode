export * as Toasts from "./index"

import { randomUUID } from "node:crypto"
import { app, BrowserWindow, Notification, webContents, type WebContents } from "electron"
import { ToastActivated } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { focusWindow, showWindow } from "../windows/focus"
import { parseToastLink, toastXml, type ToastInput } from "./toast"

type Posted = { readonly tag: string; readonly contents: number; readonly notification: Notification }

// Windows toasts by token; a tag (which names its server too) has one at a time, so any window's answer takes it back.
// Main posts them, not the page: only a main-process notification's `close()` takes it out of the notification center
// after it timed out there (electron/electron#32260), and each must stay referenced while Windows shows it.
const posted = new Map<string, Posted>()

const MAX_POSTED = 40

/**
 * Posts a toast for `sender`, replacing the earlier toast with the same tag. Its buttons need `opencode://` to reach
 * this install (they open a link); when it opens another install the toast has none.
 */
export function show(sender: WebContents, tag: string, input: ToastInput) {
  dismiss(tag)

  const token = randomUUID()
  const buttons = input.actions.length > 0 && app.isDefaultProtocolClient("opencode")

  const notification = buttons
    ? new Notification({ toastXml: toastXml(token, input) })
    : new Notification({ title: input.title, body: input.body, silent: true })

  // A toast with buttons comes back as a link (`activate`); a plain one as a click.
  notification.on("click", () => {
    if (!posted.has(token)) return
    posted.delete(token)
    focus(sender, tag)
  })

  if (posted.size >= MAX_POSTED) {
    const oldest = posted.keys().next().value

    if (oldest) {
      posted.get(oldest)?.notification.close()
      posted.delete(oldest)
    }
  }

  posted.set(token, { tag, contents: sender.id, notification })
  notification.show()
}

export function dismiss(tag: string) {
  posted.forEach((toast, token) => {
    if (toast.tag !== tag) return
    toast.notification.close()
    posted.delete(token)
  })
}

/**
 * Handles the link a toast's body or button opened. A click on the body brings its window forward; a button answers
 * in place. A toast link this app didn't post (a stale toast from an earlier run, or a forged link) only brings the
 * app forward. False when the URL isn't a toast link.
 */
export function activate(url: string, fallback: () => void) {
  const link = process.platform === "win32" ? parseToastLink(url) : undefined

  if (!link) return false
  const toast = posted.get(link.token)
  const contents = toast ? webContents.fromId(toast.contents) : undefined
  posted.delete(link.token)

  if (!toast || !contents || contents.isDestroyed()) {
    fallback()

    return true
  }

  toast.notification.close()

  if (link.action) emitIpcEvent(contents, new ToastActivated({ tag: toast.tag, action: link.action }))
  else focus(contents, toast.tag)

  return true
}

function focus(contents: WebContents, tag: string) {
  if (contents.isDestroyed()) return
  const win = BrowserWindow.fromWebContents(contents)
  showWindow(win)
  focusWindow(win, app)
  emitIpcEvent(contents, new ToastActivated({ tag }))
}
