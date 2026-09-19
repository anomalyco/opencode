import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { app, net, protocol } from "electron"
import type { BrowserWindow } from "electron"
import { documentPolicyHeader, jsCallStacksDocumentPolicy } from "./headers"
import { prepaintFile, prepaintMarker } from "./prepaint"
import { rendererHost, rendererProtocol } from "./scheme"

// Serves the renderer bundle over oc://renderer. This module has no Effect dependency because the
// entry module registers it right after Electron is ready, before the main bundle has loaded, so
// the first window can start its document while the bundle and the layers evaluate.

export const earlyQuery = "early"

type Log = (level: "warning" | "error", message: string, data: Record<string, unknown>) => void
let log: Log = () => {}

export function setRendererProtocolLogger(logger: Log) {
  log = logger
}

export function serveRenderer(rendererRoot: string) {
  if (protocol.isProtocolHandled(rendererProtocol)) return
  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      log("warning", "rejected host", { url: request.url })
      return new Response("Not found", { status: 404 })
    }

    const file = path.resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = path.relative(rendererRoot, file)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      log("warning", "rejected path", { url: request.url, file })
      return new Response("Not found", { status: 404 })
    }

    const early = url.pathname === "/index.html" ? url.searchParams.get(earlyQuery) : null
    if (early !== null) return earlyDocument(file, early)

    try {
      const range = request.headers.get("range")
      const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
      if (response.status >= 400) {
        log("error", "fetch failed", {
          url: request.url,
          file,
          status: response.status,
          statusText: response.statusText,
        })
      }
      return addDocumentPolicy(response, file)
    } catch (error) {
      log("error", "fetch error", { url: request.url, file, error })
      return new Response("Not found", { status: 404 })
    }
  })
}

// The early window loads index.html?early=<window id>: the same document without its module
// scripts, plus the shell snapshot the window captured last time, so the user sees their own UI
// while the main process is still loading. releaseRenderer() adds the scripts back once the window
// has been adopted.
async function earlyDocument(file: string, id: string) {
  const [html, prepaint] = await Promise.all([
    readFile(file, "utf8"),
    readFile(path.join(app.getPath("userData"), prepaintFile(id)), "utf8").catch(() => undefined),
  ])
  const body = prepaint?.startsWith(prepaintMarker(app.getVersion()))
    ? `<div id="oc-prepaint" inert aria-hidden="true" style="position:fixed;inset:0;z-index:100;pointer-events:none;display:flex;flex-direction:column;background-color:var(--background-base)">${prepaint.slice(prepaint.indexOf("\n") + 1)}</div></body>`
    : "</body>"
  const text = html.replace(moduleScript, "").replace("</body>", body)
  return new Response(text, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      [documentPolicyHeader]: jsCallStacksDocumentPolicy,
    },
  })
}

const moduleScript = /<script type="module"[^>]*><\/script>\s*/g

export async function releaseRenderer(win: BrowserWindow, rendererRoot: string) {
  const html = await readFile(path.join(rendererRoot, "index.html"), "utf8")
  const srcs = [...html.matchAll(moduleScript)].flatMap((match) => {
    const src = /\bsrc="([^"]+)"/.exec(match[0])
    return src ? [src[1]] : []
  })
  if (win.isDestroyed()) return
  // async = false keeps the runtime chunk ahead of the entry, as the static tags did. Dropping the
  // query afterwards makes a reload load the full document.
  await win.webContents.executeJavaScript(
    `(() => {
      for (const src of ${JSON.stringify(srcs)}) {
        const script = document.createElement("script")
        script.type = "module"
        script.async = false
        script.crossOrigin = ""
        script.src = src
        document.head.appendChild(script)
      }
      history.replaceState(history.state, "", "/index.html")
    })()`,
  )
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
