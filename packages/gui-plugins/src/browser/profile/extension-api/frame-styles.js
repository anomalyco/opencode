// Runs only in a pane document's sandboxed isolated preload world. No function or IPC channel is exposed to
// page JS. The native keys belong to this document (including in an out-of-process child), never to a URL.
if (process.type === "renderer" && process.contextIsolated && process.sandboxed && /^(https?:|about:)/.test(location.protocol)) {
  const { ipcRenderer, webFrame } = require("electron")
  const sheets = new Map()
  const forget = id => {
    const keys = sheets.get(id)
    keys?.forEach((key, name) => {
      // Keep the record for live USER keys until the document goes away (see removal below).
      if (name.startsWith("user:")) return
      webFrame.removeInsertedCSS(key)
      keys.delete(name)
    })
    if (!keys?.size) sheets.delete(id)
  }
  ipcRenderer.on("browser-extension:forget-css", (_, id) => forget(id))
  addEventListener("pagehide", () => sheets.forEach((_, id) => forget(id)), { once: true })
  ipcRenderer.on("browser-extension:css", async (_, channel, at, acknowledge) => {
    try {
      if (acknowledge) ipcRenderer.send(`${channel}:received`)
      if (at !== "document_start" && document.readyState === "loading") {
        await new Promise(resolve => addEventListener("DOMContentLoaded", resolve, { once: true }))
      }
      if (at === "document_idle" && document.readyState !== "complete") {
        await new Promise(resolve => requestIdleCallback(resolve, { timeout: 200 }))
      }
      const item = await ipcRenderer.invoke(channel)
      if (!item) return ipcRenderer.send(channel, false)
      const name = `${item.origin}:${item.css}`
      const keys = sheets.get(item.id) ?? new Map()
      if (item.remove) {
        const key = keys.get(name)
        // Electron 44's removal binding always passes Blink's default (author) origin. Do not silently
        // report success or discard a live USER key. Destruction of this document drops its native sheets.
        if (key !== undefined && item.origin === "user") return ipcRenderer.send(channel, "user-removal")
        if (key !== undefined) webFrame.removeInsertedCSS(key)
        keys.delete(name)
        if (!keys.size) sheets.delete(item.id)
      } else if (!keys.has(name)) {
        keys.set(name, webFrame.insertCSS(item.css, { cssOrigin: item.origin }))
        sheets.set(item.id, keys)
      }
      ipcRenderer.send(channel, true)
    } catch { ipcRenderer.send(channel, false) }
  })
}
