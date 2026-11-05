import { net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { documentPolicyHeader, jsCallStacksDocumentPolicy } from "./headers"
import {
  createProtocolBurstState,
  isProtocolBurstSettled,
  transitionProtocolBurst,
  type ProtocolBurstCommand,
  type ProtocolBurstEvent,
} from "./protocol-machine"
import { rendererHost, rendererProtocol } from "./scheme"

/** What a renderer protocol problem is about: the request, and the file or failure behind it. */
export type ProtocolDetails = {
  readonly url: string
  readonly file?: string
  readonly status?: number
  readonly statusText?: string
  readonly error?: Error | string
}

export type ProtocolReport = (level: "warning" | "error", message: string, data: ProtocolDetails) => void

// The entry module registers the handler the moment the first window exists, before logging is up,
// so problems go to the console until the logging layer installs a reporter.
let report: ProtocolReport = (level, message, data) => console[level === "error" ? "error" : "warn"](message, data)

export function setProtocolReporter(reporter: ProtocolReport) {
  report = reporter
}

// The entry module holds the main bundle back until the renderer's initial burst of asset requests
// has been answered, because this handler runs on the main thread and a 100 ms module evaluation
// would otherwise sit between the renderer and its HTML.
const burst = { state: createProtocolBurstState() }

const timers: { cap?: ReturnType<typeof setTimeout>; quiet?: ReturnType<typeof setTimeout> } = {}

const dispatch = (event: ProtocolBurstEvent) => {
  const next = transitionProtocolBurst(burst.state, event)
  burst.state = next.state
  next.commands.forEach(perform)
}

const perform = (command: ProtocolBurstCommand) => {
  switch (command.type) {
    case "start-cap-timer":
      clearTimeout(timers.cap)
      timers.cap = setTimeout(() => dispatch({ type: "cap.elapsed" }), command.delayMs)

      return
    case "start-quiet-timer":
      clearTimeout(timers.quiet)
      timers.quiet = setTimeout(() => dispatch({ type: "quiet.elapsed", attempt: command.attempt }), command.delayMs)

      return
    case "cancel-quiet-timer":
      clearTimeout(timers.quiet)
      timers.quiet = undefined

      return
    case "clear-timers":
      clearTimeout(timers.cap)
      clearTimeout(timers.quiet)
      timers.cap = undefined
      timers.quiet = undefined

      return
    case "resolve":
      return command.replies.forEach((reply) => reply())
  }
}

export function rendererAssetsServed(options: { quietMs: number; capMs: number }) {
  return new Promise<void>((reply) => dispatch({ type: "wait.requested", ...options, reply }))
}

/** The first window closed before the bundle loaded: the app quits, so nothing waits for its assets. */
export function cancelRendererAssetsServed() {
  dispatch({ type: "cancelled" })
}

export function registerRendererProtocol(rendererRoot: string) {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    if (isProtocolBurstSettled(burst.state)) return serve(request, rendererRoot)
    dispatch({ type: "request.started" })

    try {
      return await serve(request, rendererRoot)
    } finally {
      dispatch({ type: "request.finished" })
    }
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
    report("error", "fetch error", { url: request.url, file, error: error instanceof Error ? error : String(error) })

    return new Response("Not found", { status: 404 })
  }
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
