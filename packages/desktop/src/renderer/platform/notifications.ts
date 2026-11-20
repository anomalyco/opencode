import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

type DesktopNotifyAPI = Pick<ElectronAPI, "getWindowFocused" | "showWindow" | "setWindowFocus">

const MAX_ACTIVE_NOTIFICATIONS = 40

const activeNotifications = new Set<Notification>()

export function createDesktopNotify(api: DesktopNotifyAPI): Platform["notify"] {
  return async (title, description, onClick) => {
    const focused = await api.getWindowFocused().catch(() => document.hasFocus())

    if (focused) return

    // No icon: the system already shows the app icon, and an icon here shows the logo a second time, as a thumbnail
    // on macOS and a large image on Windows.
    const notification = new Notification(title, {
      body: description ?? "",
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
