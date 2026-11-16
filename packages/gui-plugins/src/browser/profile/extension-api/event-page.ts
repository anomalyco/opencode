import type { Session } from "electron"

/** MV2 event pages are lazy frames, not service workers. Chromium exposes their wake to the extension's own
 * runtime, not to Session.serviceWorkers. A short-lived, sandboxed view of the package's inert manifest requests
 * that native wake. It never opens a window, receives an event payload or supplies the background frame's identity. */
export async function eventPage(session: Session, scope: string, fresh: boolean, signal: AbortSignal) {
  const { webContents, WebContentsView } = await import("electron")
  signal.throwIfAborted()

  const find = () =>
    webContents
      .getAllWebContents()
      .find(
        (page) => page.session === session && page.getType() === "backgroundPage" && page.getURL().startsWith(scope),
      )

  const page = !fresh && find()

  if (page) return page

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

    const ready = await relay.executeJavaScript(
      "new Promise(resolve => chrome.runtime.getBackgroundPage(page => resolve(!!page)))",
    )

    signal.throwIfAborted()
    const awake = ready === true && find()

    if (!awake) throw new Error("Extension event page did not start.")

    return awake
  } finally {
    signal.removeEventListener("abort", close)
    close()
  }
}
