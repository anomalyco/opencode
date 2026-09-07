import { Browser } from "@opencode-ai/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"
import type { Cdp } from "./cdp"

type Request = {
  info: Browser.NetworkRequest
  nativeID: string
  sessionID?: string
  /** Monotonic start; unknown for a WebSocket until its handshake is sent. */
  started?: number
  request: Pick<Protocol.Network.Request, "headers" | "postData" | "hasPostData">
  response?: Pick<Protocol.Network.Response, "headers" | "mimeType">
  headersTruncated: boolean
  postDataTruncated: boolean
  redirected?: boolean
  /** ExtraInfo arrives once per redirect hop, in order; these mark which hops consumed theirs. */
  wire: { request: boolean; response: boolean }
}
type Wire = { headers: Protocol.Network.Headers; statusCode: number }
const levels = ["debug", "info", "warning", "error"] as const
// Values the model must not read; the header name still shows it was sent.
const redacted = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"])

export function createDiagnostics(cdp: Cdp) {
  const messages: Browser.ConsoleEntry[] = []
  const requests = new Map<string, Request>()
  // Chromium reuses one request ID across a redirect chain; every hop is retained in order.
  const hops = new Map<string, Request[]>()
  const latest = (key: string) => hops.get(key)?.at(-1)
  // Network-stack headers and wire status arrive as ExtraInfo events, in either order relative to
  // the renderer-side events; stash whichever comes first.
  const extra = new Map<string, { request?: Protocol.Network.Headers; response?: Wire }>()
  const scope = crypto.randomUUID()
  let sequence = 0
  let droppedMessages = 0
  let droppedRequests = 0
  const add = (
    level: (typeof levels)[number],
    text: string,
    timestampMs: number,
    source?: Browser.ConsoleEntry["source"],
  ) => {
    messages.push({
      id: `${scope}:${++sequence}`,
      timestampMs,
      level,
      text: text.slice(0, 2_000),
      textTruncated: text.length > 2_000,
      ...(source ? { source } : {}),
    })
    if (messages.length > 500) {
      messages.shift()
      droppedMessages++
    }
  }
  cdp.on("Runtime.consoleAPICalled", (event) => {
    const source = event.stackTrace?.callFrames[0]
    add(
      event.type === "error" || event.type === "assert"
        ? "error"
        : event.type === "warning"
          ? "warning"
          : event.type === "debug"
            ? "debug"
            : "info",
      event.args
        .map((arg) =>
          typeof arg.value === "string"
            ? arg.value
            : arg.value !== undefined
              ? JSON.stringify(arg.value)
              : (arg.description ?? arg.unserializableValue ?? arg.type),
        )
        .join(" "),
      event.timestamp,
      source
        ? { url: source.url.slice(0, Browser.MAX_TEXT), line: source.lineNumber + 1, column: source.columnNumber + 1 }
        : undefined,
    )
  })
  cdp.on("Runtime.exceptionThrown", (event) => {
    const error = event.exceptionDetails
    add(
      "error",
      error.exception?.description ?? error.text,
      event.timestamp,
      error.url ? { url: error.url, line: error.lineNumber + 1, column: error.columnNumber + 1 } : undefined,
    )
  })
  const begin = (
    key: string,
    sessionID: string | undefined,
    nativeID: string,
    started: number | undefined,
    wallTime: number,
    info: Pick<Browser.NetworkRequest, "url" | "method" | "resourceType">,
    request: Request["request"],
  ) => {
    const headers = trimHeaders(request.headers)
    const entry: Request = {
      nativeID,
      sessionID,
      started,
      request: { ...request, headers: headers.headers, postData: request.postData?.slice(0, 20_000) },
      headersTruncated: headers.truncated,
      postDataTruncated: (request.postData?.length ?? 0) > 20_000,
      wire: { request: false, response: false },
      info: {
        id: `${scope}:${++sequence}`,
        ...info,
        url: info.url.slice(0, 16_384),
        timestampMs: wallTime * 1000,
        state: "pending",
      },
    }
    requests.set(entry.info.id, entry)
    hops.set(key, [...(hops.get(key) ?? []), entry])
    // A stash can only belong to this hop: earlier hops would have consumed it on arrival.
    const stashed = extra.get(key)
    if (stashed?.request) requestHeaders(entry, stashed.request)
    if (stashed?.response) responseInfo(entry, stashed.response)
    extra.delete(key)
    if (requests.size > 500) {
      const first = requests.values().next().value
      if (first) {
        requests.delete(first.info.id)
        const firstKey = `${first.sessionID ?? ""}:${first.nativeID}`
        const rest = hops.get(firstKey)?.filter((hop) => hop !== first) ?? []
        if (rest.length) hops.set(firstKey, rest)
        if (!rest.length) hops.delete(firstKey)
      }
      droppedRequests++
    }
    return entry
  }
  const requestHeaders = (request: Request, headers: Protocol.Network.Headers) => {
    const trimmed = trimHeaders({ ...request.request.headers, ...headers })
    request.request = { ...request.request, headers: trimmed.headers }
    request.headersTruncated ||= trimmed.truncated
    request.wire.request = true
  }
  const responseInfo = (request: Request, wire: Wire) => {
    const trimmed = trimHeaders({ ...request.response?.headers, ...wire.headers })
    request.response = { mimeType: request.response?.mimeType ?? "", headers: trimmed.headers }
    request.headersTruncated ||= trimmed.truncated
    request.info = { ...request.info, statusCode: wire.statusCode }
    request.wire.response = true
  }
  const finish = (key: string, timestamp: number, failure?: string) => {
    const request = latest(key)
    if (!request) return
    const durationMs = request.started === undefined ? 0 : Math.max(0, (timestamp - request.started) * 1000)
    request.info =
      failure === undefined
        ? { ...request.info, state: "completed", durationMs }
        : { ...request.info, state: "failed", failure: failure.slice(0, 2_048), durationMs }
  }
  cdp.on("Network.requestWillBeSent", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    const previous = latest(key)
    if (previous && event.redirectResponse) {
      // Wire headers for this hop may already be merged in; the renderer copy lacks set-cookie.
      const response = trimHeaders({ ...event.redirectResponse.headers, ...previous.response?.headers })
      previous.response = { mimeType: event.redirectResponse.mimeType, headers: response.headers }
      previous.headersTruncated ||= response.truncated
      previous.redirected = true
      previous.info = {
        ...previous.info,
        state: "completed",
        statusCode: previous.info.statusCode ?? event.redirectResponse.status,
        durationMs: Math.max(0, (event.timestamp - (previous.started ?? event.timestamp)) * 1000),
      }
    }
    begin(
      key,
      sessionID,
      event.requestId,
      event.timestamp,
      event.wallTime,
      {
        url: event.request.url,
        method: event.request.method,
        resourceType: resourceType((event.type ?? "other").toLowerCase()),
      },
      { headers: event.request.headers, hasPostData: event.request.hasPostData, postData: event.request.postData },
    )
  })
  // ExtraInfo for a redirect hop can land after the renderer already started the next hop, so it
  // goes to the earliest hop that has not consumed its own rather than to the latest.
  cdp.on("Network.requestWillBeSentExtraInfo", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    const request = hops.get(key)?.find((hop) => !hop.wire.request)
    if (request) return requestHeaders(request, event.headers)
    extra.set(key, { ...extra.get(key), request: event.headers })
  })
  cdp.on("Network.responseReceived", (event, sessionID) => {
    const request = latest(`${sessionID ?? ""}:${event.requestId}`)
    if (!request) return
    const headers = trimHeaders({ ...event.response.headers, ...request.response?.headers })
    request.response = { mimeType: event.response.mimeType, headers: headers.headers }
    request.headersTruncated ||= headers.truncated
    // ExtraInfo already carries the wire status when it arrived first; the renderer may report 200 for a 304.
    request.info = { ...request.info, statusCode: request.info.statusCode ?? event.response.status }
  })
  cdp.on("Network.responseReceivedExtraInfo", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    const request = hops.get(key)?.find((hop) => !hop.wire.response)
    if (request) return responseInfo(request, event)
    extra.set(key, { ...extra.get(key), response: event })
  })
  // WebSockets never emit requestWillBeSent; their handshake is the whole request lifecycle.
  cdp.on("Network.webSocketCreated", (event, sessionID) => {
    begin(
      `${sessionID ?? ""}:${event.requestId}`,
      sessionID,
      event.requestId,
      undefined,
      Date.now() / 1000,
      { url: event.url, method: "GET", resourceType: "websocket" },
      { headers: {}, hasPostData: false },
    )
  })
  cdp.on("Network.webSocketWillSendHandshakeRequest", (event, sessionID) => {
    const request = latest(`${sessionID ?? ""}:${event.requestId}`)
    if (!request) return
    request.started = event.timestamp
    request.info = { ...request.info, timestampMs: event.wallTime * 1000 }
    requestHeaders(request, event.request.headers)
  })
  cdp.on("Network.webSocketHandshakeResponseReceived", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    const request = latest(key)
    if (!request) return
    responseInfo(request, { headers: event.response.headers, statusCode: event.response.status })
    finish(key, event.timestamp)
  })
  cdp.on("Network.webSocketFrameError", (event, sessionID) =>
    finish(`${sessionID ?? ""}:${event.requestId}`, event.timestamp, event.errorMessage),
  )
  cdp.on("Network.webSocketClosed", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    if (latest(key)?.info.state === "pending") finish(key, event.timestamp, "Closed before the handshake completed")
  })
  cdp.on("Network.loadingFinished", (event, sessionID) =>
    finish(`${sessionID ?? ""}:${event.requestId}`, event.timestamp),
  )
  cdp.on("Network.loadingFailed", (event, sessionID) =>
    finish(`${sessionID ?? ""}:${event.requestId}`, event.timestamp, event.errorText),
  )
  return {
    clear() {
      messages.length = 0
      requests.clear()
      hops.clear()
      extra.clear()
      droppedMessages = 0
      droppedRequests = 0
    },
    async enable(sessionID?: string) {
      await cdp.send("Runtime.enable", {}, sessionID)
      await cdp.send(
        "Network.enable",
        { maxTotalBufferSize: 5 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024, maxPostDataSize: 20_000 },
        sessionID,
      )
    },
    console(input: Extract<Browser.Action, { type: "console" }>) {
      const matching = messages.filter((entry) => levels.indexOf(entry.level) >= levels.indexOf(input.level ?? "info"))
      const result = bounded(matching, input.limit ?? 100)
      return { messages: result, truncated: matching.length > result.length, dropped: droppedMessages }
    },
    list(input: Extract<Browser.Action, { type: "network.list" }>) {
      const matching = Array.from(requests.values())
        .map((request) => request.info)
        .filter(
          (request) =>
            (!input.urlContains || request.url.includes(input.urlContains)) &&
            (!input.resourceType || input.resourceType === request.resourceType),
        )
      const result = bounded(matching, input.limit ?? 100)
      return { requests: result, truncated: matching.length > result.length, dropped: droppedRequests }
    },
    info(id: string) {
      const request = requests.get(id)
      if (!request)
        throw new Error(
          "Request is no longer retained. Call browser.network.list({tabID}) and use a current request id. Do not reload or resend it just to inspect it.",
        )
      return request.info
    },
    async get(input: Extract<Browser.Action, { type: "network.get" }>) {
      const request = requests.get(input.id)
      if (!request)
        throw new Error(
          "Request ID is no longer retained in this tab or belongs to another tab. Call browser.network.list({tabID}) and copy a current id into browser.network.get with the same tabID. Do not reload or resend a request just to inspect it.",
        )
      const max = input.maxBodyChars ?? 20_000
      const text = (value: string): Browser.Body => ({
        state: "text",
        text: value.slice(0, max),
        truncated: value.length > max,
      })
      const responseBody = async (): Promise<Browser.Body> => {
        if (!input.includeBody) return { state: "notRequested" }
        if (request.info.state === "pending") return { state: "pending" }
        if (request.redirected || !request.response || request.info.resourceType === "websocket")
          return { state: "unavailable", reason: "notCaptured" }
        if (
          !/^(text\/|application\/(json|.*\+json|javascript|xml|.*\+xml|x-www-form-urlencoded))/i.test(
            request.response.mimeType,
          )
        )
          return { state: "unavailable", reason: "binary" }
        const body = await cdp
          .send("Network.getResponseBody", { requestId: request.nativeID }, request.sessionID)
          .catch(() => undefined)
        if (!body) return { state: "unavailable", reason: "backendUnavailable" }
        const value = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body
        return value.length ? text(value) : { state: "empty" }
      }
      const requestBody: Browser.Body = !input.includeBody
        ? { state: "notRequested" }
        : request.request.postData !== undefined
          ? {
              state: "text",
              text: request.request.postData.slice(0, max),
              truncated: request.postDataTruncated || request.request.postData.length > max,
            }
          : request.request.hasPostData
            ? { state: "unavailable", reason: "notCaptured" }
            : { state: "empty" }
      return {
        request: request.info,
        requestHeaders: headerEntries(request.request.headers),
        responseHeaders: headerEntries(request.response?.headers ?? {}),
        headersTruncated: request.headersTruncated,
        requestBody,
        responseBody: await responseBody(),
      }
    },
  }
}

function resourceType(type: string): Browser.ResourceType {
  switch (type) {
    case "document":
    case "stylesheet":
    case "image":
    case "media":
    case "font":
    case "script":
    case "xhr":
    case "fetch":
    case "eventsource":
    case "websocket":
    case "manifest":
      return type
    default:
      return "other"
  }
}

function trimHeaders(headers: Protocol.Network.Headers) {
  const entries = Object.entries(headers)
  const kept: [string, string][] = []
  let size = 0
  let truncated = entries.length > 100
  for (const [key, value] of entries.slice(0, 100)) {
    // Lower-case names so renderer and wire copies of one header merge instead of duplicating.
    const name = key.toLowerCase().slice(0, 2_048)
    const text = redacted.has(name) ? "<redacted>" : String(value)
    const remaining = Math.max(0, 16_000 - size - name.length)
    if (!remaining) {
      truncated = true
      break
    }
    const bounded = text.slice(0, Math.min(2_000, remaining))
    truncated ||= bounded.length < text.length || name.length < key.length
    kept.push([name, bounded])
    size += name.length + bounded.length
  }
  return { headers: Object.fromEntries(kept), truncated }
}

function bounded<Item>(items: readonly Item[], limit: number) {
  const selected: Item[] = []
  let size = 0
  for (const item of items.slice(-limit).reverse()) {
    size += JSON.stringify(item).length
    if (size > Browser.MAX_TEXT) break
    selected.push(item)
  }
  return selected.reverse()
}

function headerEntries(headers: Protocol.Network.Headers) {
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }))
}
