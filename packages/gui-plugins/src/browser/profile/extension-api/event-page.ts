import type { Session } from "electron"

/** MV2 event pages are lazy frames, not service workers. Chromium exposes their wake to the extension's own
 * runtime, not to Session.serviceWorkers. A short-lived, sandboxed view of the package's inert manifest requests
 * that native wake. It never opens a window, receives an event payload or supplies the background frame's identity. */
export async function eventPage(session: Session, scope: string, fresh: boolean, signal: AbortSignal) {
  const { webContents } = await import("electron")
  signal.throwIfAborted()

  const find = () =>
    webContents
      .getAllWebContents()
      .find(
        (page) => page.session === session && page.getType() === "backgroundPage" && page.getURL().startsWith(scope),
      )

  const page = !fresh && find()

  if (page) return page

  const ready = await manifestQuery(session, scope, "wake", signal)
  const awake = ready && find()

  if (!awake) throw new Error("Extension event page did not start.")

  return awake
}

/** Run a fixed, read-only query in the extension's own origin. Nothing is exposed to the pane or the caller. */
export async function manifestQuery(session: Session, scope: string, query: "wake" | "rulesets", signal: AbortSignal) {
  const { WebContentsView } = await import("electron")
  signal.throwIfAborted()

  const relay = new WebContentsView({
    webPreferences: {
      session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
    },
  }).webContents

  const close = () => {
    if (!relay.isDestroyed()) relay.close()
  }

  const blocked = (event: Electron.Event) => event.preventDefault()
  relay.setWindowOpenHandler(() => ({ action: "deny" }))
  relay.on("will-frame-navigate", blocked)
  relay.on("will-redirect", blocked)
  signal.addEventListener("abort", close, { once: true })

  try {
    const url = new URL("manifest.json", scope).href
    await relay.loadURL(url)

    if (relay.getURL() !== url) throw new Error("Extension event page did not open.")

    const ready = await relay.executeJavaScript(query === "rulesets"
      ? "chrome.declarativeNetRequest.getEnabledRulesets().then(ids => Array.isArray(ids))"
      : "new Promise(resolve => chrome.runtime.getBackgroundPage(page => resolve(!!page)))")

    signal.throwIfAborted()

    return ready === true
  } finally {
    signal.removeEventListener("abort", close)
    close()
  }
}
