/**
 * Cloud-specific entry point for Claxedo.
 *
 * This file initializes cloud extensions and renders the OpenCode app
 * with cloud functionality enabled.
 */

// @refresh reload
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { PlatformProvider, type Platform } from "@opencode-ai/claxedo-app"
import { initClaxedo, getDefaultConfig } from "./index"
import { getAuthToken } from "./utils/auth-client"
import { ConfigProvider } from "./context/config"

// Initialize cloud extensions before rendering
const config = getDefaultConfig()
initClaxedo(config)

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Make sure there is an element with id='root' in your index.html"
  )
}

/**
 * Authenticated fetch that adds Clerk JWT token to requests.
 * Handles both URL string and Request object inputs.
 */
const authFetch: typeof fetch = async (input, init) => {
  const token = await getAuthToken()

  // Handle Request object input - headers are on the Request, not in init
  const existingHeaders = input instanceof Request ? input.headers : init?.headers
  const headers = new Headers(existingHeaders)

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

/**
 * Platform configuration for cloud/web mode.
 */
const platform: Platform = {
  platform: "web",
  version: "cloud",
  fetch: authFetch,
  getAuthToken,
  openLink(url: string) {
    window.open(url, "_blank")
  },
  restart: async () => {
    window.location.reload()
  },
  back() {
    window.history.back()
  },
  forward() {
    window.history.forward()
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
          icon: "https://opencode.ai/favicon-96x96-v3.png",
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

// Render the standard app with cloud extensions active
// ConfigProvider is the outermost provider to make config available everywhere
render(
  () => (
    <ConfigProvider config={config}>
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <AppInterface />
        </AppBaseProviders>
      </PlatformProvider>
    </ConfigProvider>
  ),
  root!
)
