import type { Session, WebContents } from "electron"
import { manifestQuery } from "./extension-api/event-page"

// Electron's extension-ready means the package was registered, not that its asynchronous request filter is ready.
// An unpacked extension, a lookalike name or a different manifest version must not select a package-specific handshake.
export function filterStartup(id: string, source: string, manifestVersion: number) {
  if (source !== "store") return

  if (id === "odfafepnkmbhccpbejgmiehpchacaeak" && manifestVersion === 2) return "background"

  if (id === "ddkjiahejlhfcafbddmgiahcphecmpfh" && manifestVersion === 3) return "rulesets"
}

// uBO's start.js sets readyToFilter *before* initializing its tabs and installing the filtering listener. Wait for
// the startup promise and check the listener, not merely for a document or a registered chrome.webRequest callback.
export const filterReadiness = `globalThis.µBlock?.isReadyPromise?.then(() =>
  globalThis.µBlock.readyToFilter === true && typeof globalThis.vAPI?.net?.suspendableListener === 'function')`

export async function waitForFilter(
  session: Session,
  scope: string,
  kind: "background" | "rulesets",
  lifetime: AbortSignal,
) {
  const { app, webContents } = await import("electron")
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)])
  signal.throwIfAborted()
  const ready = Promise.withResolvers<void>()

  if (kind === "rulesets") {
    const stop = () => ready.reject(signal.reason)
    signal.addEventListener("abort", stop, { once: true })

    try {
      const initialized = await Promise.race([manifestQuery(session, scope, "filtering", signal), ready.promise])

      if (!initialized) throw new Error("Filter rulesets are not ready.")

      return
    } finally {
      signal.removeEventListener("abort", stop)
    }
  }

  const url = new URL("background.html", scope).href
  const pages = new Map<WebContents, () => void>()
  const stop = () => ready.reject(signal.reason)

  const watch = (page: WebContents) => {
    if (page.session !== session || page.getType() !== "backgroundPage" || pages.has(page)) return

    const inspect = () => {
      if (page.isDestroyed() || page.getURL() !== url) return
      void page.executeJavaScript(filterReadiness).then(
        (value) => {
          if (value === true && !page.isDestroyed() && page.getURL() === url) ready.resolve()
        },
        () => {},
      )
    }

    pages.set(page, inspect)
    page.on("did-finish-load", inspect)

    if (!page.isLoadingMainFrame()) inspect()
  }

  // On first run uBO reloads itself after writing its version. Only the replacement background can report ready.
  const created = (_event: Electron.Event, page: WebContents) => watch(page)
  app.on("web-contents-created", created)
  signal.addEventListener("abort", stop, { once: true })

  try {
    webContents.getAllWebContents().forEach(watch)
    await ready.promise
  } finally {
    signal.removeEventListener("abort", stop)
    app.off("web-contents-created", created)
    pages.forEach((inspect, page) => {
      if (!page.isDestroyed()) page.off("did-finish-load", inspect)
    })
  }
}
