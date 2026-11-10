import { Browser } from "@opencode/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"
import type { Cdp } from "./cdp"
import {
  evictHop,
  MAX_RETAINED_REQUESTS,
  MAX_STASHED_CHAINS,
  networkRequest,
  requestBody,
  responseBody,
  transitionChain,
  type Chain,
  type ChainEvent,
  type Hop,
} from "./diagnostics-machine"

const levels = ["debug", "info", "warning", "error"] as const

export function createDiagnostics(cdp: Cdp) {
  const messages: Browser.ConsoleEntry[] = []
  // Every hop by its public id, oldest first.
  const requests = new Map<string, Hop>()
  // Hops per CDP request ID, keyed `${sessionID}:${requestId}`.
  const chains = new Map<string, Chain>()
  // Keys of chains that hold only queued ExtraInfo, oldest first.
  const stashed = new Set<string>()
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
    const entry: Browser.ConsoleEntry = {
      id: `${scope}:${++sequence}`,
      timestampMs,
      level,
      text: text.slice(0, 2_000),
      textTruncated: text.length > 2_000,
    }

    messages.push(source ? { ...entry, source } : entry)

    if (messages.length > 500) {
      messages.shift()
      droppedMessages++
    }
  }

  const apply = (key: string, event: ChainEvent) => {
    const previous = chains.get(key)
    const next = transitionChain(previous, event)

    if (next === previous) return

    if (!next) {
      chains.delete(key)
      stashed.delete(key)

      return
    }

    chains.set(key, next)

    if (!next.hops.length) {
      stashed.add(key)
      const oldest = stashed.values().next().value

      if (stashed.size > MAX_STASHED_CHAINS && oldest !== undefined) {
        stashed.delete(oldest)
        chains.delete(oldest)
      }

      return
    }

    stashed.delete(key)
    next.hops.forEach((hop, index) => {
      if (previous?.hops[index] !== hop) requests.set(hop.id, hop)
    })

    while (requests.size > MAX_RETAINED_REQUESTS) {
      const first = requests.values().next().value

      if (!first) break
      requests.delete(first.id)
      droppedRequests++
      const firstKey = `${first.sessionID ?? ""}:${first.nativeID}`
      const chain = chains.get(firstKey)
      const rest = chain && evictHop(chain, first.id)

      if (rest) chains.set(firstKey, rest)

      if (!rest) chains.delete(firstKey)
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
          arg.type === "string"
            ? String(arg.value)
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
  // Chromium's own messages (CSP refusals, mixed content, failed resource loads, deprecations)
  // are Log entries, not Runtime console calls.
  cdp.on("Log.entryAdded", (event) => {
    const entry = event.entry
    add(
      entry.level === "verbose" ? "debug" : entry.level,
      entry.text,
      entry.timestamp,
      entry.url
        ? { url: entry.url.slice(0, Browser.MAX_TEXT), line: (entry.lineNumber ?? 0) + 1, column: 1 }
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

  cdp.on("Network.requestWillBeSent", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "request", id: `${scope}:${++sequence}`, sessionID, event }),
  )
  cdp.on("Network.requestWillBeSentExtraInfo", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "request.extra", headers: event.headers }),
  )
  cdp.on("Network.responseReceived", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "response", event }),
  )
  cdp.on("Network.responseReceivedExtraInfo", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, {
      type: "response.extra",
      wire: { headers: event.headers, statusCode: event.statusCode },
    }),
  )
  // WebSockets never emit requestWillBeSent; their handshake is the whole request lifecycle.
  cdp.on("Network.webSocketCreated", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, {
      type: "ws.created",
      id: `${scope}:${++sequence}`,
      sessionID,
      event,
      wallTime: Date.now() / 1000,
    }),
  )
  cdp.on("Network.webSocketWillSendHandshakeRequest", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "ws.request", event }),
  )
  cdp.on("Network.webSocketHandshakeResponseReceived", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "ws.response", event }),
  )
  cdp.on("Network.webSocketFrameError", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, {
      type: "ws.error",
      timestamp: event.timestamp,
      message: event.errorMessage,
    }),
  )
  cdp.on("Network.webSocketClosed", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "ws.closed", timestamp: event.timestamp }),
  )
  cdp.on("Network.loadingFinished", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, { type: "finished", timestamp: event.timestamp }),
  )
  cdp.on("Network.loadingFailed", (event, sessionID) =>
    apply(`${sessionID ?? ""}:${event.requestId}`, {
      type: "failed",
      timestamp: event.timestamp,
      errorText: event.errorText,
    }),
  )
  // An out-of-process frame that detaches never finishes its requests.
  cdp.on("Target.detachedFromTarget", (event) =>
    Array.from(chains.keys())
      .filter((key) => key.startsWith(`${event.sessionId}:`))
      .forEach((key) => apply(key, { type: "detached" })),
  )

  const retained = (id: string, message: string) => {
    const hop = requests.get(id)

    if (!hop) throw new Error(message)

    return hop
  }

  return {
    clear() {
      messages.length = 0
      requests.clear()
      chains.clear()
      stashed.clear()
      droppedMessages = 0
      droppedRequests = 0
    },
    async enable(sessionID?: string) {
      await cdp.send("Runtime.enable", {}, sessionID)
      await cdp.send("Log.enable", {}, sessionID)
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
        .filter(
          (hop) =>
            (!input.urlContains || hop.url.includes(input.urlContains)) &&
            (!input.resourceType || input.resourceType === hop.resourceType),
        )
        .map(networkRequest)

      const result = bounded(matching, input.limit ?? 100)

      return { requests: result, truncated: matching.length > result.length, dropped: droppedRequests }
    },
    info(id: string) {
      return networkRequest(
        retained(
          id,
          "Request is no longer retained. Call browser.network.list({tabID}) and use a current request id. Do not reload or resend it just to inspect it.",
        ),
      )
    },
    async get(input: Extract<Browser.Action, { type: "network.get" }>) {
      const hop = retained(
        input.id,
        "Request ID is no longer retained in this tab or belongs to another tab. Call browser.network.list({tabID}) and copy a current id into browser.network.get with the same tabID. Do not reload or resend a request just to inspect it.",
      )

      const max = input.maxBodyChars ?? 20_000

      const fetchBody = async (): Promise<Browser.Body> => {
        const body = await cdp
          .send("Network.getResponseBody", { requestId: hop.nativeID }, hop.sessionID)
          .catch(() => undefined)

        if (!body) return { state: "unavailable", reason: "backendUnavailable" }
        const value = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body

        return value.length ? { state: "text", text: value.slice(0, max), truncated: value.length > max } : { state: "empty" }
      }

      const known = responseBody(hop, input.includeBody)

      return {
        request: networkRequest(hop),
        requestHeaders: headerEntries(hop.request.headers),
        responseHeaders: headerEntries(hop.response?.headers ?? {}),
        headersTruncated: hop.headersTruncated,
        requestBody: requestBody(hop, input.includeBody, max),
        responseBody: known === "fetch" ? await fetchBody() : known,
      }
    },
  }
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
