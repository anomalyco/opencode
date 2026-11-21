import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

type DesktopNotifyAPI = Pick<
  ElectronAPI,
  "getWindowFocused" | "showWindow" | "setWindowFocus" | "showToast" | "dismissToast" | "onToastActivated"
>

const MAX_ACTIVE_NOTIFICATIONS = 40

// What a Windows toast's second line shows of a request, at most.
const DETAIL_LIMIT = 160

const activeNotifications = new Set<Notification>()

// What each Windows toast main posted for this window runs when clicked, by tag.
const toasts = new Map<string, () => void>()

export function createDesktopNotify(
  api: DesktopNotifyAPI,
  os?: "macos" | "windows" | "linux",
): Pick<Platform, "notify" | "dismissNotification"> {
  const windows = os === "windows"

  if (windows) {
    api.onToastActivated((tag) => {
      const onClick = toasts.get(tag)
      toasts.delete(tag)
      onClick?.()
    })
  }

  return {
    notify: async (title, description, onClick, options) => {
      const focused = await api.getWindowFocused().catch(() => document.hasFocus())

      if (focused) return

      // On Windows a tagged notification is a toast main posts, so a repeat replaces it and an answer takes it back.
      if (windows && options?.tag) {
        remember(options.tag, onClick ?? (() => {}))
        const body = [description, clip(options.detail)].filter(Boolean).join("\n")

        return api.showToast({ tag: options.tag, title, body }).catch(() => undefined)
      }

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://opencode.ai/favicon-96x96-v3.png",
        silent: true,
      })

      if (activeNotifications.size >= MAX_ACTIVE_NOTIFICATIONS) {
        const oldest = activeNotifications.values().next().value

        if (oldest) activeNotifications.delete(oldest)
      }

      activeNotifications.add(notification)

      const release = () => {
        activeNotifications.delete(notification)
        notification.onclick = null
        notification.onclose = null
        notification.onerror = null
      }

      notification.onclose = release
      notification.onerror = release

      notification.onclick = () => {
        release()
        void Promise.all([api.showWindow(), api.setWindowFocus()])
        onClick?.()
        notification.close()
      }
    },
    // Main holds the toasts, also ones this page posted before a reload or another window posted.
    dismissNotification: (tag) => {
      if (!windows) return
      toasts.delete(tag)
      void api.dismissToast(tag).catch(() => undefined)
    },
  }
}

function remember(tag: string, onClick: () => void) {
  toasts.delete(tag)

  if (toasts.size >= MAX_ACTIVE_NOTIFICATIONS) {
    const oldest = toasts.keys().next().value

    if (oldest !== undefined) toasts.delete(oldest)
  }

  toasts.set(tag, onClick)
}

function clip(value: string | undefined) {
  const text = value?.split(/\s+/).filter(Boolean).join(" ")

  if (!text || text.length <= DETAIL_LIMIT) return text

  return `${text.slice(0, DETAIL_LIMIT - 1)}…`
}
