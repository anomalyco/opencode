import { net, protocol } from "electron"
import type { BrowserWindow } from "electron"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { writeLog } from "../native/logging"
import { rendererRoot } from "../paths"

const rendererProtocol = "oc"
const rendererHost = "renderer"
const documentPolicyHeader = "Document-Policy"
const jsCallStacksDocumentPolicy = "include-js-call-stacks-in-crash-reports"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      writeLog("protocol", "rejected host", { url: request.url }, "warn")
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      writeLog("protocol", "rejected path", { url: request.url, file }, "warn")
      return new Response("Not found", { status: 404 })
    }

    try {
      const range = request.headers.get("range")
      const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
      if (response.status >= 400) {
        writeLog(
          "protocol",
          "fetch failed",
          { url: request.url, file, status: response.status, statusText: response.statusText },
          "error",
        )
      }
      return addDocumentPolicy(response, file)
    } catch (error) {
      writeLog("protocol", "fetch error", { url: request.url, file, error }, "error")
      return new Response("Not found", { status: 404 })
    }
  })
}

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

export function addRendererHeaders(value: string, headers: object) {
  upsertHeader(headers, "Access-Control-Allow-Origin", ["*"])
  upsertHeader(headers, "Access-Control-Allow-Headers", ["*"])
  if (isRendererUrl(value, true)) upsertHeader(headers, documentPolicyHeader, [jsCallStacksDocumentPolicy])
}

export function upsertHeader(headers: object, key: string, value: string | string[]) {
  const current = Object.keys(headers).find((header) => header.toLowerCase() === key.toLowerCase())
  Reflect.set(headers, current ?? key, value)
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
