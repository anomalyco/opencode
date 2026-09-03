import { Browser } from "@opencode-ai/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"
import type { Cdp } from "./cdp"

type Request = {
  info: Browser.NetworkRequest
  nativeID: string
  sessionID?: string
  started: number
  request: Pick<Protocol.Network.Request, "headers" | "postData" | "hasPostData">
  response?: Pick<Protocol.Network.Response, "headers" | "mimeType">
  headersTruncated: boolean
  postDataTruncated: boolean
  redirected?: boolean
}
const levels = ["debug", "info", "warning", "error"] as const

export function createDiagnostics(cdp: Cdp) {
  const messages: Browser.ConsoleEntry[] = []
  const requests = new Map<string, Request>()
  const current = new Map<string, Request>()
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
  cdp.on("Network.requestWillBeSent", (event, sessionID) => {
    const key = `${sessionID ?? ""}:${event.requestId}`
    const previous = current.get(key)
    if (previous && event.redirectResponse) {
      const response = trimHeaders(event.redirectResponse.headers)
      previous.response = { mimeType: event.redirectResponse.mimeType, headers: response.headers }
      previous.headersTruncated ||= response.truncated
      previous.redirected = true
      previous.info = {
        ...previous.info,
        state: "completed",
        statusCode: event.redirectResponse.status,
        durationMs: Math.max(0, (event.timestamp - previous.started) * 1000),
      }
    }
    const type = (event.type ?? "other").toLowerCase()
    const id = `${scope}:${++sequence}`
    const headers = trimHeaders(event.request.headers)
    const request: Request = {
      nativeID: event.requestId,
      sessionID,
      started: event.timestamp,
      request: {
        headers: headers.headers,
        hasPostData: event.request.hasPostData,
        postData: event.request.postData?.slice(0, 20_000),
      },
      headersTruncated: headers.truncated,
      postDataTruncated: (event.request.postData?.length ?? 0) > 20_000,
      info: {
        id,
        url: event.request.url.slice(0, 16_384),
        method: event.request.method,
        resourceType: resourceType(type),
        timestampMs: event.wallTime * 1000,
        state: "pending",
      },
    }
    requests.set(id, request)
    current.set(key, request)
    if (requests.size > 500) {
      const first = requests.values().next().value
      if (first) {
        requests.delete(first.info.id)
        if (current.get(`${first.sessionID ?? ""}:${first.nativeID}`) === first)
          current.delete(`${first.sessionID ?? ""}:${first.nativeID}`)
      }
      droppedRequests++
    }
  })
  cdp.on("Network.responseReceived", (event, sessionID) => {
    const request = current.get(`${sessionID ?? ""}:${event.requestId}`)
    if (!request) return
    const headers = trimHeaders(event.response.headers)
    request.response = { mimeType: event.response.mimeType, headers: headers.headers }
    request.headersTruncated ||= headers.truncated
    request.info = { ...request.info, statusCode: event.response.status }
  })
  cdp.on("Network.loadingFinished", (event, sessionID) => {
    const request = current.get(`${sessionID ?? ""}:${event.requestId}`)
    if (request)
      request.info = {
        ...request.info,
        state: "completed",
        durationMs: Math.max(0, (event.timestamp - request.started) * 1000),
      }
  })
  cdp.on("Network.loadingFailed", (event, sessionID) => {
    const request = current.get(`${sessionID ?? ""}:${event.requestId}`)
    if (request)
      request.info = {
        ...request.info,
        state: "failed",
        failure: event.errorText.slice(0, 2_048),
        durationMs: Math.max(0, (event.timestamp - request.started) * 1000),
      }
  })
  return {
    clear() {
      messages.length = 0
      requests.clear()
      current.clear()
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
        if (request.redirected || !request.response) return { state: "unavailable", reason: "notCaptured" }
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
    const name = key.slice(0, 2_048)
    const text = String(value)
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
