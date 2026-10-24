import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import type { Platform } from "./platform"

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
    notify,
  }

  return {
    platform,
    currentServerUrl: getCurrentServerUrl(),
  }
}

export async function notify(
  title: string,
  description?: string,
  onClick?: () => void,
  href?: string,
): Promise<void> {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  if (document.visibilityState === "visible" && document.hasFocus()) return

  const options = {
    body: description ?? "",
    icon: "/favicon.ico",
  }

  const registration = "serviceWorker" in navigator ? await activeRegistration() : undefined

  if (registration?.active) {
    await registration.showNotification(title, {
      ...options,
      tag: href,
      data: { url: new URL(href ?? location.href, location.href).href },
    })

    return
  }

  try {
    // Android Chrome rejects the constructor; with no active worker there is no
    // notification API left, so fail silently rather than break the session event.
    const notification = new Notification(title, options)
    notification.onclick = () => {
      window.focus()
      onClick?.()
      notification.close()
    }
  } catch {
    return
  }
}

async function activeRegistration(timeout = 3_000) {
  const registration = await navigator.serviceWorker.getRegistration()

  if (!registration || registration.active) return registration
  const worker = registration.installing ?? registration.waiting

  if (!worker) return registration
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      worker.removeEventListener("statechange", changed)
      resolve()
    }

    const changed = () => {
      if (worker.state === "activated" || worker.state === "redundant") finish()
    }

    const timer = setTimeout(finish, timeout)
    worker.addEventListener("statechange", changed)
    changed()
  })

  return registration.active ? registration : undefined
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
