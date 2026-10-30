import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

type DesktopNotifyAPI = Pick<ElectronAPI, "getWindowFocused" | "showWindow" | "setWindowFocus">

const MAX_ACTIVE_NOTIFICATIONS = 40

const activeNotifications = new Set<Notification>()

export function createDesktopNotify(api: DesktopNotifyAPI): Platform["notify"] {
  return async (title, description, onClick) => {
    const focused = await api.getWindowFocused().catch(() => document.hasFocus())

    if (focused) return

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
  }
}
