import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import { uuid } from "@opencode/util/uuid"
import { Predicate } from "effect"
import type { Platform } from "./platform"

// A service worker cannot run a page's click callback, so its notificationclick handler posts the notification key
// back to every window (see notification-click.js) and only the window that created the notification runs the
// callback held here. A reload loses the pending callbacks; a click then only brings the app forward.
const clickCallbacks = new Map<string, () => void>()

const MAX_CLICK_CALLBACKS = 40

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    // SAFETY: messages arrive only from this app's own notification-click.js worker script, whose payload shape is
    // published here and checked field by field before use.
    const data = event.data as { type?: unknown; key?: unknown } | null

    if (data?.type !== "opencode:notificationclick" || !Predicate.isString(data.key)) return

    const callback = clickCallbacks.get(data.key)

    if (!callback) return
    clickCallbacks.delete(data.key)
    window.focus()
    callback()
  })
}

export function createWebNotify(): Platform["notify"] {
  return async (title, description, onClick) => {
    if (!("Notification" in window)) return

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission

    if (permission !== "granted") return

    if (document.visibilityState === "visible" && document.hasFocus()) return

    const options = { body: description ?? "", icon: "https://opencode.ai/favicon-96x96-v3.png" }

    // Chrome for Android has no Notification constructor and only shows through the service worker. A missing
    // registration is registered once more in case the startup attempt failed, then the constructor takes over
    // wherever it exists. Everything here settles: a notification must never reject or hang its caller.
    const registration =
      typeof navigator === "undefined" || !("serviceWorker" in navigator)
        ? undefined
        : (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ??
          (await navigator.serviceWorker.register("/sw.js").catch(() => undefined))

    if (registration?.active) {
      const key = uuid()

      if (onClick) {
        clickCallbacks.set(key, onClick)

        if (clickCallbacks.size > MAX_CLICK_CALLBACKS) {
          const oldest = clickCallbacks.keys().next().value

          if (oldest) clickCallbacks.delete(oldest)
        }
      }

      await registration.showNotification(title, { ...options, tag: key, data: { key } }).catch(() => undefined)

      return
    }

    try {
      const notification = new Notification(title, options)

      notification.onclick = () => {
        window.focus()
        onClick?.()
        notification.close()
      }
    } catch {
      // Chrome for Android throws here; without an active service worker a notification cannot be shown at all.
    }
  }
}

export function createWebPlatform(version: string) {
  const platform: Platform = {
    platform: "web",
    draftStore: createBrowserDraftStore(),
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)

      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
      window.open(url.href, "_blank", "noopener,noreferrer")
    },
    restart: async () => window.location.reload(),
    notify: createWebNotify(),
  }

  return {
    platform,
    currentServerUrl: getCurrentServerUrl(),
  }
}

function getCurrentServerUrl() {
  if (import.meta.env.VITE_OPENCODE_SERVER_MODE === "none") return undefined

  if (import.meta.env.DEV) {
    const loopback =
      location.hostname === "localhost" || location.hostname === "[::1]" || location.hostname.startsWith("127.")

    const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? (loopback ? location.hostname : "localhost")

    return `http://${host}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }

  return location.origin
}
