// @refresh reload
// Mirror entry point — serves the desktop UI in a browser via the web mirror proxy.
// Sets platform: "desktop" so all desktop-gated features are visible,
// but uses browser-compatible implementations (no Tauri APIs).
// Storage falls back to localStorage (persist.ts: platform === "desktop" && !platform.storage → localStorage).
// Auth is handled natively by the browser (HTTP Basic Auth challenge → browser dialog → cached per origin).
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import pkg from "../package.json"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  const locale = (() => {
    if (typeof navigator !== "object") return "en" as const
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      if (language.toLowerCase().startsWith("zh")) return "zh" as const
    }
    return "en" as const
  })()

  const key = "error.dev.rootNotFound" as const
  const message = locale === "zh" ? (zh[key] ?? en[key]) : en[key]
  throw new Error(message)
}

const platform: Platform = {
  // "desktop" unlocks all desktop-gated UI sections (<Show when={platform.platform === "desktop"}>).
  // Without platform.storage, persist.ts falls through to localStorage — exactly what we want.
  platform: "desktop",
  version: pkg.version,

  openLink(url: string) {
    window.open(url, "_blank")
  },

  back() {
    window.history.back()
  },

  forward() {
    window.history.forward()
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

  // No fetch override — browser handles HTTP Basic Auth natively.
  // The sidecar's basicAuth middleware sends WWW-Authenticate: Basic,
  // the browser shows its native login dialog, and caches credentials for the origin.
  // All subsequent fetch() calls from JS automatically include the cached auth header.

  // No getDefaultServerUrl/setDefaultServerUrl — the mirror always connects to its own origin
  // (window.location.origin in production, handled by app.tsx line 105).

  // No startWebMirror/stopWebMirror/getWebMirrorStatus — these are Tauri-only.
  // The Web Mirror settings section will be hidden because platform.startWebMirror is undefined.
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
