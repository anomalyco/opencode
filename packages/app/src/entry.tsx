// @refresh reload
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { Platform, PlatformProvider } from "@/context/platform"
import pkg from "../package.json"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/opencode_csrf=([^;]+)/)
  return match ? match[1] : undefined
}

const csrfFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return fetch(input, init)
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init?.headers) {
      const initHeaders = new Headers(init.headers)
      initHeaders.forEach((value, key) => headers.set(key, value))
    }

    const csrfToken = getCsrfToken()
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)

    return fetch(input, { ...init, headers })
  },
  {
    preconnect: (url: string | URL) => {
      if ("preconnect" in fetch) {
        fetch.preconnect(url)
      }
    },
  },
)

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  fetch: csrfFetch,
  openLink(url: string) {
    window.open(url, "_blank")
  },
  restart: async () => {
    window.location.reload()
  },
  notify: async (title, description, href) => {
    if (!("Notification" in window)) return

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission

    if (permission !== "granted") return

    const inView = document.visibilityState === "visible" && document.hasFocus()
    if (inView) return

    await Promise.resolve()
      .then(() => {
        const notification = new Notification(title, {
          body: description ?? "",
          icon: "https://opencode.ai/favicon-96x96.png",
        })
        notification.onclick = () => {
          window.focus()
          if (href) {
            window.history.pushState(null, "", href)
            window.dispatchEvent(new PopStateEvent("popstate"))
          }
          notification.close()
        }
      })
      .catch(() => undefined)
  },
}

render(
  () => (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  root!,
)
