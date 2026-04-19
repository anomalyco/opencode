export const NOTIFICATION_OPEN_EVENT = "opencode:notification-open"
export const NOTIFICATION_PERMISSION_GRANTED_EVENT = "opencode:notification-permission-granted"
export const SERVICE_WORKER_NOTIFICATION_OPEN = "notification.open"

let nav: ((href: string) => void) | undefined

export const setNavigate = (fn?: (href: string) => void) => {
  nav = fn
}

export const handleNotificationClick = (href?: string) => {
  if (typeof window === "object") {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_OPEN_EVENT, { detail: { href } }))
    window.focus()
  }
  if (!href) return
  if (nav) return nav(href)
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}
