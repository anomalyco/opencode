import { protocol } from "electron"
import type { BrowserWindow } from "electron"

export const rendererProtocol = "oc"
export const rendererHost = "renderer"

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

// Scheme privileges can only be granted before the app is ready, so the entry module calls this
// before it loads anything else.
export function registerRendererScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: rendererProtocol,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        stream: true,
        // Let Chromium keep V8 bytecode for the renderer bundle between launches.
        codeCache: true,
      },
    },
  ])
}
