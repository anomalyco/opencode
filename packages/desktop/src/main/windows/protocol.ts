import { net, protocol } from "electron"
import type { BrowserWindow } from "electron"
import { pathToFileURL } from "node:url"
import { Effect, Path } from "effect"
import { scoped } from "../native/logging"
import { DesktopPaths } from "../paths"
import { documentPolicyHeader, jsCallStacksDocumentPolicy } from "./headers"
import { DesktopStorage } from "../storage"
import { extensionAssetResponse } from "../extensions/assets"

const rendererProtocol = "oc"
const rendererHost = "renderer"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

export const registerRendererProtocol = Effect.fn("Window.registerRendererProtocol")(function* () {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const storage = yield* DesktopStorage.Service
  const runFork = Effect.runForkWith(yield* Effect.context<never>())
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host === "extensions") {
      const [id, revision, ...parts] = url.pathname.slice(1).split("/").map(decodeURIComponent)
      if (!id || !revision) return new Response(null, { status: 404 })
      const response = extensionAssetResponse(storage.db, {
        id,
        revision,
        path: parts.join("/"),
        range: request.headers.get("range"),
        head: request.method === "HEAD",
      })
      const origin = request.headers.get("origin")
      if (origin && isRendererUrl(origin)) response.headers.set("Access-Control-Allow-Origin", origin)
      return response
    }
    if (url.host !== rendererHost) {
      runFork(scoped("protocol", Effect.logWarning("rejected host", { url: request.url })))
      return new Response("Not found", { status: 404 })
    }

    const file = path.resolve(paths.rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = path.relative(paths.rendererRoot, file)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      runFork(scoped("protocol", Effect.logWarning("rejected path", { url: request.url, file })))
      return new Response("Not found", { status: 404 })
    }

    try {
      const range = request.headers.get("range")
      const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
      if (response.status >= 400) {
        runFork(
          scoped(
            "protocol",
            Effect.logError("fetch failed", {
              url: request.url,
              file,
              status: response.status,
              statusText: response.statusText,
            }),
          ),
        )
      }
      return addDocumentPolicy(response, file)
    } catch (error) {
      runFork(scoped("protocol", Effect.logError("fetch error", { url: request.url, file, error })))
      return new Response("Not found", { status: 404 })
    }
  })
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

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
