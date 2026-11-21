export * as Toasts from "./index"

import { randomUUID } from "node:crypto"
import { app, BrowserWindow, Notification, webContents, type WebContents } from "electron"
import { ToastActivated } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { focusWindow, showWindow } from "../windows/focus"
import { parseToastLink, toastXml, type ToastInput } from "./toast"

type Posted = { readonly tag: string; readonly contents: number; readonly notification: Notification }

// Toasts by token. Each holds its Electron notification, which must stay referenced while Windows shows it.
const posted = new Map<string, Posted>()

const MAX_POSTED = 40

/**
 * Posts a toast with buttons for `sender`, replacing its earlier toast with the same tag. False when buttons can't
 * reach the app (not Windows, or `opencode://` opens another install), so the caller posts a plain one instead.
 */
export function show(sender: WebContents, tag: string, input: ToastInput) {
  if (process.platform !== "win32" || !Notification.isSupported() || !app.isDefaultProtocolClient("opencode"))
    return false
  dismiss(sender, tag)

  const token = randomUUID()
  const notification = new Notification({ toastXml: toastXml(token, input) })

  if (posted.size >= MAX_POSTED) {
    const oldest = posted.keys().next().value

    if (oldest) forget(oldest)
  }

  posted.set(token, { tag, contents: sender.id, notification })
  notification.show()

  return true
}

export function dismiss(sender: WebContents, tag: string) {
  posted.forEach((toast, token) => {
    if (toast.contents !== sender.id || toast.tag !== tag) return
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

  if (!toast || !contents || contents.isDestroyed()) {
    if (toast) forget(link.token)
    fallback()

    return true
  }

  forget(link.token)

  if (!link.action) {
    const win = BrowserWindow.fromWebContents(contents)
    showWindow(win)
    focusWindow(win, app)
  }

  emitIpcEvent(contents, new ToastActivated({ tag: toast.tag, action: link.action }))

  return true
}

function forget(token: string) {
  posted.get(token)?.notification.close()
  posted.delete(token)
}
