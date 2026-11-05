import type { Browser } from "@opencode/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"

// One CDP request ID's hops. Chromium reuses a request ID across a redirect chain, and the network
// service sends each hop's wire headers and status as ExtraInfo events that can arrive before or
// after the renderer's events for that hop.

export const MAX_RETAINED_REQUESTS = 500

/** Request IDs that have ExtraInfo but no hop yet; past this the oldest is forgotten. */
export const MAX_STASHED_CHAINS = 128

/** ExtraInfo payloads queued per request ID before their hops arrive. */
export const MAX_WIRE_QUEUE = 16

export type HopPhase =
  /** A WebSocket before its handshake request, so it has no start time yet. */
  | { readonly status: "connecting" }
  | { readonly status: "pending"; readonly started: number }
  /** An HTTP hop that answered with a redirect; the next hop carries on under the same request ID. */
  | { readonly status: "redirected"; readonly durationMs: number }
  | { readonly status: "completed"; readonly durationMs: number }
  | { readonly status: "failed"; readonly durationMs: number; readonly failure: string }

/** Which ExtraInfo events the hop can still take: `none` once it took both or never will. */
export type HopWire = "both" | "request" | "response" | "none"

export type Hop = {
  readonly id: string
  readonly nativeID: string
  readonly sessionID: string | undefined
  readonly url: string
  readonly method: string
  readonly resourceType: Browser.ResourceType
  readonly timestampMs: number
  readonly statusCode: number | undefined
  readonly request: { readonly headers: Protocol.Network.Headers; readonly postData?: string; readonly hasPostData?: boolean }
  readonly response: { readonly headers: Protocol.Network.Headers; readonly mimeType: string } | undefined
  readonly headersTruncated: boolean
  readonly postDataTruncated: boolean
  readonly wire: HopWire
  readonly phase: HopPhase
}

export type WireResponse = { readonly headers: Protocol.Network.Headers; readonly statusCode: number }

export type Chain = {
  readonly hops: readonly Hop[]
  /** Request ExtraInfo that arrived before its hop, oldest first. */
  readonly requestWire: readonly Protocol.Network.Headers[]
  /** Response ExtraInfo that arrived before its hop, oldest first. */
  readonly responseWire: readonly WireResponse[]
}

export type ChainEvent =
  | {
      readonly type: "request"
      readonly id: string
      readonly sessionID: string | undefined
      readonly event: Protocol.Network.RequestWillBeSentEvent
    }
  | { readonly type: "request.extra"; readonly headers: Protocol.Network.Headers }
  | { readonly type: "response"; readonly event: Protocol.Network.ResponseReceivedEvent }
  | { readonly type: "response.extra"; readonly wire: WireResponse }
  | {
      readonly type: "ws.created"
      readonly id: string
      readonly sessionID: string | undefined
      readonly event: Protocol.Network.WebSocketCreatedEvent
      readonly wallTime: number
    }
  | { readonly type: "ws.request"; readonly event: Protocol.Network.WebSocketWillSendHandshakeRequestEvent }
  | { readonly type: "ws.response"; readonly event: Protocol.Network.WebSocketHandshakeResponseReceivedEvent }
  | { readonly type: "ws.error"; readonly timestamp: number; readonly message: string }
  | { readonly type: "ws.closed"; readonly timestamp: number }
  | { readonly type: "finished"; readonly timestamp: number }
  | { readonly type: "failed"; readonly timestamp: number; readonly errorText: string }
  /** The frame target that owns the request ID went away; it sends nothing more. */
  | { readonly type: "detached" }

const EMPTY: Chain = { hops: [], requestWire: [], responseWire: [] }

/**
 * Returns `chain` itself when the event does not apply, and undefined when the request ID has
 * nothing left worth keeping.
 */
export function transitionChain(chain: Chain | undefined, event: ChainEvent): Chain | undefined {
  const current = chain ?? EMPTY
  const latest = current.hops.at(-1)

  switch (event.type) {
    case "request": {
      const redirect = event.event.redirectResponse
      const hops =
        latest && redirect
          ? replaceLast(current.hops, redirected(latest, redirect, event.event))
          : supersede(current.hops, event.event.timestamp)

      return append({ ...current, hops }, {
        id: event.id,
        nativeID: event.event.requestId,
        sessionID: event.sessionID,
        url: event.event.request.url.slice(0, 16_384),
        method: event.event.request.method,
        resourceType: resourceType((event.event.type ?? "other").toLowerCase()),
        timestampMs: event.event.wallTime * 1000,
        request: {
          headers: event.event.request.headers,
          hasPostData: event.event.request.hasPostData,
          postData: event.event.request.postData,
        },
        started: event.event.timestamp,
      })
    }
    case "ws.created":
      return append({ ...current, hops: supersede(current.hops, undefined) }, {
        id: event.id,
        nativeID: event.event.requestId,
        sessionID: event.sessionID,
        url: event.event.url.slice(0, 16_384),
        method: "GET",
        resourceType: "websocket",
        timestampMs: event.wallTime * 1000,
        request: { headers: {}, hasPostData: false },
        started: undefined,
      })
    case "request.extra": {
      const index = current.hops.findIndex((hop) => hop.wire === "both" || hop.wire === "request")

      if (index === -1) {
        if (current.requestWire.length >= MAX_WIRE_QUEUE) return chain

        return { ...current, requestWire: [...current.requestWire, event.headers] }
      }

      return { ...current, hops: replaceAt(current.hops, index, requestWire(current.hops[index], event.headers)) }
    }
    case "response.extra":
      return responseExtra(chain, current, event.wire)
    case "response": {
      if (!latest || latest.phase.status !== "pending") return chain
      const headers = trimHeaders({ ...event.event.response.headers, ...latest.response?.headers })

      return {
        ...current,
        hops: replaceLast(current.hops, {
          ...latest,
          response: { mimeType: event.event.response.mimeType, headers: headers.headers },
          headersTruncated: latest.headersTruncated || headers.truncated,
          // Wire status from ExtraInfo wins: the renderer may report 200 for a 304.
          statusCode: latest.statusCode ?? event.event.response.status,
          wire: event.event.hasExtraInfo ? latest.wire : "none",
        }),
      }
    }
    case "ws.request": {
      if (!latest || latest.resourceType !== "websocket" || !open(latest)) return chain
      const headers = trimHeaders({ ...event.event.request.headers, ...latest.request.headers })

      return {
        ...current,
        hops: replaceLast(current.hops, {
          ...latest,
          request: { ...latest.request, headers: headers.headers },
          headersTruncated: latest.headersTruncated || headers.truncated,
          timestampMs: event.event.wallTime * 1000,
          phase: { status: "pending", started: event.event.timestamp },
        }),
      }
    }
    case "ws.response": {
      // A WebSocket's handshake is its whole request lifecycle; later frame errors and closes do not change it.
      if (!latest || latest.resourceType !== "websocket" || !open(latest)) return chain
      const headers = trimHeaders({ ...event.event.response.headers, ...latest.response?.headers })

      return {
        ...current,
        hops: replaceLast(current.hops, {
          ...latest,
          response: { mimeType: latest.response?.mimeType ?? "", headers: headers.headers },
          headersTruncated: latest.headersTruncated || headers.truncated,
          statusCode: latest.statusCode ?? event.event.response.status,
          phase: { status: "completed", durationMs: elapsed(latest.phase, event.event.timestamp) },
        }),
      }
    }
    case "ws.error":
    case "ws.closed":
      if (!latest || latest.resourceType !== "websocket" || !open(latest)) return chain

      return {
        ...current,
        hops: replaceLast(
          current.hops,
          fail(
            latest,
            event.timestamp,
            event.type === "ws.error" ? event.message : "Closed before the handshake completed",
          ),
        ),
      }
    case "finished":
    case "failed":
      // Only queued ExtraInfo: the request ended before the renderer reported it.
      if (!latest) return undefined

      if (!open(latest)) return chain

      return {
        ...current,
        hops: replaceLast(
          current.hops,
          event.type === "failed"
            ? fail(latest, event.timestamp, event.errorText)
            : { ...latest, phase: { status: "completed", durationMs: elapsed(latest.phase, event.timestamp) } },
        ),
      }
    case "detached": {
      if (!latest) return undefined

      if (
        current.hops.every((hop) => hop.wire === "none" && !open(hop)) &&
        !current.requestWire.length &&
        !current.responseWire.length
      )
        return chain

      return {
        hops: current.hops.map((hop) =>
          open(hop)
            ? {
                ...hop,
                wire: "none",
                phase: { status: "failed", durationMs: 0, failure: "Frame detached before request completed" },
              }
            : hop.wire === "none"
              ? hop
              : { ...hop, wire: "none" },
        ),
        requestWire: [],
        responseWire: [],
      }
    }
  }
}

/** Removes an evicted hop; undefined when the request ID has no hops left. */
export function evictHop(chain: Chain, id: string): Chain | undefined {
  const hops = chain.hops.filter((hop) => hop.id !== id)

  return hops.length ? { ...chain, hops } : undefined
}

/** The hop as the browser tools report it. */
export function networkRequest(hop: Hop): Browser.NetworkRequest {
  const base = {
    id: hop.id,
    url: hop.url,
    method: hop.method,
    resourceType: hop.resourceType,
    timestampMs: hop.timestampMs,
    statusCode: hop.statusCode,
  }

  switch (hop.phase.status) {
    case "connecting":
    case "pending":
      return { ...base, state: "pending" }
    case "redirected":
    case "completed":
      return { ...base, state: "completed", durationMs: hop.phase.durationMs }
    case "failed":
      return { ...base, state: "failed", durationMs: hop.phase.durationMs, failure: hop.phase.failure }
  }
}

/** The captured request body, bounded to `max` characters. */
export function requestBody(hop: Hop, includeBody: boolean | undefined, max: number): Browser.Body {
  if (!includeBody) return { state: "notRequested" }

  if (hop.request.postData !== undefined)
    return {
      state: "text",
      text: hop.request.postData.slice(0, max),
      truncated: hop.postDataTruncated || hop.request.postData.length > max,
    }

  return hop.request.hasPostData ? { state: "unavailable", reason: "notCaptured" } : { state: "empty" }
}

/** The response body when it is known without asking Chromium, else `fetch`. */
export function responseBody(hop: Hop, includeBody: boolean | undefined): Browser.Body | "fetch" {
  if (!includeBody) return { state: "notRequested" }

  if (open(hop)) return { state: "pending" }

  if (hop.phase.status === "redirected" || !hop.response || hop.resourceType === "websocket")
    return { state: "unavailable", reason: "notCaptured" }

  if (
    !/^(text\/|application\/(json|.*\+json|javascript|xml|.*\+xml|x-www-form-urlencoded))/i.test(hop.response.mimeType)
  )
    return { state: "unavailable", reason: "binary" }

  return "fetch"
}

function responseExtra(chain: Chain | undefined, current: Chain, wire: WireResponse): Chain | undefined {
  const index = current.hops.findIndex(awaitsResponse)

  if (index === -1) {
    if (current.responseWire.length >= MAX_WIRE_QUEUE) return chain

    return { ...current, responseWire: [...current.responseWire, wire] }
  }
  const later = current.hops.findIndex((hop, at) => at > index && hop.phase.status !== "redirected" && awaitsResponse(hop))

  // A redirect hop that never sent its response ExtraInfo cannot take a final status; give it to the
  // live hop and stop the redirect hops in between from waiting.
  if (current.hops[index].phase.status === "redirected" && !isRedirect(wire.statusCode) && later !== -1)
    return {
      ...current,
      hops: current.hops.map((hop, at) =>
        at === later ? responseWire(hop, wire) : at >= index && at < later ? { ...hop, wire: "none" } : hop,
      ),
    }

  return { ...current, hops: replaceAt(current.hops, index, responseWire(current.hops[index], wire)) }
}

function append(
  chain: Chain,
  input: Pick<Hop, "id" | "nativeID" | "sessionID" | "url" | "method" | "resourceType" | "timestampMs" | "request"> & {
    started: number | undefined
  },
): Chain {
  const headers = trimHeaders(input.request.headers)
  const created: Hop = {
    id: input.id,
    nativeID: input.nativeID,
    sessionID: input.sessionID,
    url: input.url,
    method: input.method,
    resourceType: input.resourceType,
    timestampMs: input.timestampMs,
    statusCode: undefined,
    request: { ...input.request, headers: headers.headers, postData: input.request.postData?.slice(0, 20_000) },
    response: undefined,
    headersTruncated: headers.truncated,
    postDataTruncated: (input.request.postData?.length ?? 0) > 20_000,
    wire: "both",
    phase: input.started === undefined ? { status: "connecting" } : { status: "pending", started: input.started },
  }
  // Queued ExtraInfo can only belong to this hop: earlier hops took theirs on arrival.
  const requested = chain.requestWire.length ? requestWire(created, chain.requestWire[0]) : created
  const hop = chain.responseWire.length ? responseWire(requested, chain.responseWire[0]) : requested

  return {
    hops: [...chain.hops, hop],
    requestWire: chain.requestWire.slice(1),
    responseWire: chain.responseWire.slice(1),
  }
}

/** The previous hop when the renderer reused its request ID without a redirect: it will hear nothing more. */
function supersede(hops: readonly Hop[], timestamp: number | undefined) {
  const latest = hops.at(-1)

  if (!latest || (latest.wire === "none" && !open(latest))) return hops

  if (!open(latest)) return replaceLast(hops, { ...latest, wire: "none" })

  return replaceLast(hops, { ...fail(latest, timestamp, "Superseded by a new request"), wire: "none" })
}

function redirected(
  hop: Hop,
  redirect: Protocol.Network.Response,
  event: Protocol.Network.RequestWillBeSentEvent,
): Hop {
  // Wire headers for this hop may already be merged in; the renderer copy lacks set-cookie.
  const headers = trimHeaders({ ...redirect.headers, ...hop.response?.headers })

  return {
    ...hop,
    response: { mimeType: redirect.mimeType, headers: headers.headers },
    headersTruncated: hop.headersTruncated || headers.truncated,
    statusCode: hop.statusCode ?? redirect.status,
    // A cached redirect never gets ExtraInfo; the next hop's must not be attributed to it.
    wire: event.redirectHasExtraInfo ? hop.wire : "none",
    phase: { status: "redirected", durationMs: elapsed(hop.phase, event.timestamp) },
  }
}

function requestWire(hop: Hop, headers: Protocol.Network.Headers): Hop {
  const trimmed = trimHeaders({ ...hop.request.headers, ...headers })

  return {
    ...hop,
    request: { ...hop.request, headers: trimmed.headers },
    headersTruncated: hop.headersTruncated || trimmed.truncated,
    wire: hop.wire === "both" ? "response" : "none",
  }
}

function responseWire(hop: Hop, wire: WireResponse): Hop {
  const trimmed = trimHeaders({ ...hop.response?.headers, ...wire.headers })

  return {
    ...hop,
    response: { mimeType: hop.response?.mimeType ?? "", headers: trimmed.headers },
    headersTruncated: hop.headersTruncated || trimmed.truncated,
    statusCode: wire.statusCode,
    wire: hop.wire === "both" ? "request" : "none",
  }
}

function fail(hop: Hop, timestamp: number | undefined, failure: string): Hop {
  return {
    ...hop,
    phase: { status: "failed", durationMs: elapsed(hop.phase, timestamp), failure: failure.slice(0, 2_048) },
  }
}

function open(hop: Hop) {
  return hop.phase.status === "connecting" || hop.phase.status === "pending"
}

function awaitsResponse(hop: Hop) {
  return hop.wire === "both" || hop.wire === "response"
}

function isRedirect(statusCode: number) {
  return statusCode >= 300 && statusCode < 400
}

/** A WebSocket's creation carries no monotonic time, so superseding one by it reports 0. */
function elapsed(phase: HopPhase, timestamp: number | undefined) {
  return phase.status === "pending" && timestamp !== undefined ? Math.max(0, (timestamp - phase.started) * 1000) : 0
}

function replaceLast(hops: readonly Hop[], hop: Hop) {
  return replaceAt(hops, hops.length - 1, hop)
}

function replaceAt(hops: readonly Hop[], index: number, hop: Hop) {
  return hops.map((item, at) => (at === index ? hop : item))
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

// Values the model must not read; the header name still shows it was sent.
const redacted: readonly string[] = ["cookie", "set-cookie", "authorization", "proxy-authorization"]

function trimHeaders(headers: Protocol.Network.Headers) {
  const entries = Object.entries(headers)
  const kept: [string, string][] = []
  let size = 0
  let truncated = entries.length > 100

  for (const [key, value] of entries.slice(0, 100)) {
    // Lower-case names so renderer and wire copies of one header merge instead of duplicating.
    const name = key.toLowerCase().slice(0, 2_048)
    const text = redacted.includes(name) ? "<redacted>" : String(value)
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
