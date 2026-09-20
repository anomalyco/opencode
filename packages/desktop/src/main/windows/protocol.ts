import { net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { documentPolicyHeader, jsCallStacksDocumentPolicy } from "./headers"
import { rendererHost, rendererProtocol } from "./scheme"

export type ProtocolReport = (level: "warning" | "error", message: string, data: Record<string, unknown>) => void

// The entry module registers the handler the moment the first window exists, before logging is up,
// so problems go to the console until the logging layer installs a reporter.
let report: ProtocolReport = (level, message, data) => console[level === "error" ? "error" : "warn"](message, data)

export function setProtocolReporter(reporter: ProtocolReport) {
  report = reporter
}

export function registerRendererProtocol(rendererRoot: string) {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    return serve(request, rendererRoot)
  })
}

async function serve(request: Request, rendererRoot: string) {
  const url = new URL(request.url)
  if (url.host !== rendererHost) {
    report("warning", "rejected host", { url: request.url })
    return new Response("Not found", { status: 404 })
  }

  const file = path.resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
  const rel = path.relative(rendererRoot, file)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    report("warning", "rejected path", { url: request.url, file })
    return new Response("Not found", { status: 404 })
  }

  try {
    const range = request.headers.get("range")
    const response = await net.fetch(pathToFileURL(file).toString(), { headers: range ? { range } : undefined })
    if (response.status >= 400) {
      report("error", "fetch failed", {
        url: request.url,
        file,
        status: response.status,
        statusText: response.statusText,
      })
    }
    return addDocumentPolicy(response, file)
  } catch (error) {
    report("error", "fetch error", { url: request.url, file, error })
    return new Response("Not found", { status: 404 })
  }
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

