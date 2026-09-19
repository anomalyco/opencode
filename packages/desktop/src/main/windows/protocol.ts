import type { BrowserWindow } from "electron"
import { Effect } from "effect"
import { scoped } from "../native/logging"
import { DesktopPaths } from "../paths"
import { rendererHost, rendererProtocol } from "./scheme"
import { serveRenderer, setRendererProtocolLogger } from "./serve"

// The entry module normally registers the handler before the bundle loads; this only wires its
// logging, and registers it when the entry module did not (development, or a window created later).
export const registerRendererProtocol = Effect.fn("Window.registerRendererProtocol")(function* () {
  const paths = yield* DesktopPaths.resolve
  const runFork = Effect.runForkWith(yield* Effect.context<never>())
  setRendererProtocolLogger((level, message, data) =>
    runFork(scoped("protocol", level === "error" ? Effect.logError(message, data) : Effect.logWarning(message, data))),
  )
  serveRenderer(paths.rendererRoot)
})

export function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(new URL(html, devUrl).toString())
    return
  }
  void win.loadURL(`${rendererProtocol}://${rendererHost}/${html}`)
}

export function isRendererUrl(value?: string, html = false) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (html && !url.pathname.endsWith(".html")) return false
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}