import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

type DesktopNotifyAPI = Pick<ElectronAPI, "getWindowFocused" | "showWindow" | "setWindowFocus">

const MAX_ACTIVE_NOTIFICATIONS = 40

// What a Windows toast's second line shows of a request, at most.
const DETAIL_LIMIT = 160

const activeNotifications = new Set<Notification>()

// Windows toasts by tag, so a repeat replaces its toast and an answer takes it out of the notification center.
const tagged = new Map<string, Notification>()

export function createDesktopNotify(
  api: DesktopNotifyAPI,
  os?: "macos" | "windows" | "linux",
): Pick<Platform, "notify" | "dismissNotification"> {
  const windows = os === "windows"

  return {
    notify: async (title, description, onClick, options) => {
      const focused = await api.getWindowFocused().catch(() => document.hasFocus())

      if (focused) return
      const tag = windows ? options?.tag : undefined
      const detail = windows ? clip(options?.detail) : undefined

      if (tag) tagged.get(tag)?.close()

      const init: NotificationOptions = {
        body: [description, detail].filter(Boolean).join("\n"),
        // On Windows the renderer's own icon, resolved against the page, so a toast needs no network to show it.
        icon: windows ? "favicon-96x96-v3.png" : "https://opencode.ai/favicon-96x96-v3.png",
        silent: true,
      }

      if (tag) init.tag = tag

      const notification = new Notification(title, init)

      if (activeNotifications.size >= MAX_ACTIVE_NOTIFICATIONS) {
        const oldest = activeNotifications.values().next().value

        if (oldest) activeNotifications.delete(oldest)
      }

      activeNotifications.add(notification)

      if (tag) remember(tag, notification)

      const release = () => {
        activeNotifications.delete(notification)

        if (tag && tagged.get(tag) === notification) tagged.delete(tag)
        notification.onclick = null
        notification.onclose = null
        notification.onerror = null
      }

      // On Windows a toast that times out fires `close` too, but it still sits in the notification center: a tagged one
      // stays known until it is replaced or dismissed, so an answer can still take it back.
      notification.onclose = tag ? () => activeNotifications.delete(notification) : release
      notification.onerror = release

      notification.onclick = () => {
        release()
        void Promise.all([api.showWindow(), api.setWindowFocus()])
        onClick?.()
        notification.close()
      }
    },
    dismissNotification: (tag) => {
      tagged.get(tag)?.close()
      tagged.delete(tag)
    },
  }
}

function remember(tag: string, notification: Notification) {
  tagged.delete(tag)

  if (tagged.size >= MAX_ACTIVE_NOTIFICATIONS) {
    const oldest = tagged.keys().next().value

    if (oldest !== undefined) tagged.delete(oldest)
  }

  tagged.set(tag, notification)
}

function clip(value: string | undefined) {
  const text = value?.split(/\s+/).filter(Boolean).join(" ")

  if (!text || text.length <= DETAIL_LIMIT) return text

  return `${text.slice(0, DETAIL_LIMIT - 1)}…`
}
