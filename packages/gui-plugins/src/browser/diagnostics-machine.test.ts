import { describe, expect, test } from "bun:test"
import type { Protocol } from "devtools-protocol"
import {
  evictHop,
  MAX_WIRE_QUEUE,
  networkRequest,
  responseBody,
  transitionChain,
  type Chain,
  type ChainEvent,
} from "./diagnostics-machine"

const replay = (events: readonly ChainEvent[], chain?: Chain) =>
  events.reduce<Chain | undefined>((last, event) => transitionChain(last, event), chain)

const response = (status: number, headers: Protocol.Network.Headers = {}): Protocol.Network.Response => ({
  url: "http://site/",
  status,
  statusText: "",
  headers,
  mimeType: "text/html",
  charset: "utf-8",
  connectionReused: false,
  connectionId: 1,
  encodedDataLength: 0,
  securityState: "neutral",
})

const sent = (
  id: string,
  url: string,
  timestamp: number,
  redirect?: { readonly response: Protocol.Network.Response; readonly hasExtraInfo: boolean },
): ChainEvent => ({
  type: "request",
  id,
  sessionID: undefined,
  event: {
    requestId: "r1",
    loaderId: "l1",
    documentURL: url,
    request: { url, method: "GET", headers: {}, initialPriority: "High", referrerPolicy: "no-referrer" },
    timestamp,
    wallTime: 1_000 + timestamp,
    initiator: { type: "other" },
    redirectHasExtraInfo: redirect?.hasExtraInfo ?? false,
    redirectResponse: redirect?.response,
    type: "Fetch",
  },
})

const received = (status: number, hasExtraInfo: boolean, timestamp = 1): ChainEvent => ({
  type: "response",
  event: { requestId: "r1", loaderId: "l1", timestamp, type: "Fetch", response: response(status), hasExtraInfo },
})

const requestExtra = (headers: Protocol.Network.Headers): ChainEvent => ({ type: "request.extra", headers })

const responseExtra = (statusCode: number, headers: Protocol.Network.Headers = {}): ChainEvent => ({
  type: "response.extra",
  wire: { headers, statusCode },
})

const created: ChainEvent = {
  type: "ws.created",
  id: "ws",
  sessionID: undefined,
  event: { requestId: "r1", url: "ws://site/socket" },
  wallTime: 1_000,
}

const handshake: ChainEvent = {
  type: "ws.request",
  event: { requestId: "r1", timestamp: 1, wallTime: 1_001, request: { headers: {} } },
}

const upgraded: ChainEvent = {
  type: "ws.response",
  event: { requestId: "r1", timestamp: 1.5, response: { status: 101, statusText: "Switching Protocols", headers: {} } },
}

const hops = (chain: Chain | undefined) => chain?.hops.map(networkRequest) ?? []

describe("redirect chains", () => {
  test("give each hop its own ExtraInfo when the network service runs ahead of the renderer", () => {
    // Both hops' ExtraInfo arrived before either requestWillBeSent; the single stash slot used to keep only hop 2's.
    const chain = replay([
      requestExtra({ Cookie: "" }),
      responseExtra(302, { "Set-Cookie": "sid=1", Location: "/app" }),
      requestExtra({ Cookie: "sid=1" }),
      responseExtra(200, { "Content-Type": "text/html" }),
      sent("h1", "http://site/login", 1),
      sent("h2", "http://site/app", 1.1, { response: response(302), hasExtraInfo: true }),
      received(200, true, 1.2),
      { type: "finished", timestamp: 1.3 },
    ])

    expect(hops(chain)).toMatchObject([
      { id: "h1", state: "completed", statusCode: 302 },
      { id: "h2", state: "completed", statusCode: 200 },
    ])
    expect(chain?.hops[0].response?.headers).toMatchObject({ "set-cookie": "<redacted>", location: "/app" })
    expect(chain?.hops[1].request.headers).toMatchObject({ cookie: "<redacted>" })
    expect(chain?.hops.map((hop) => hop.wire)).toEqual(["none", "none"])
    expect(chain?.requestWire).toEqual([])
    expect(chain?.responseWire).toEqual([])
  })

  test("keep a redirect's status when it never sent its response ExtraInfo", () => {
    // hop 1 sent only request ExtraInfo; hop 2's 200 used to overwrite hop 1's 307.
    const chain = replay([
      sent("h1", "http://site/", 1),
      requestExtra({}),
      sent("h2", "https://site/", 1.1, { response: response(307), hasExtraInfo: true }),
      requestExtra({}),
      received(200, true, 1.2),
      responseExtra(200, { "x-wire": "1" }),
      { type: "finished", timestamp: 1.3 },
    ])

    expect(hops(chain)).toMatchObject([
      { id: "h1", statusCode: 307 },
      { id: "h2", state: "completed", statusCode: 200 },
    ])
    expect(chain?.hops[0].wire).toBe("none")
    expect(chain?.hops[1].response?.headers).toMatchObject({ "x-wire": "1" })

    if (!chain) throw new Error("No chain")
    expect(responseBody(chain.hops[0], true)).toEqual({ state: "unavailable", reason: "notCaptured" })
    expect(responseBody(chain.hops[1], true)).toBe("fetch")
  })

  test("a reused request ID without a redirect settles the previous hop", () => {
    // The previous hop used to stay pending forever and take the new hop's ExtraInfo.
    const chain = replay([sent("h1", "http://site/", 1), sent("h2", "http://site/", 2), responseExtra(204)])

    expect(hops(chain)).toMatchObject([
      { id: "h1", state: "failed", failure: "Superseded by a new request", durationMs: 1_000 },
      { id: "h2", state: "pending", statusCode: 204 },
    ])
  })

  test("a completed hop stops taking ExtraInfo once a new hop starts", () => {
    const chain = replay([
      sent("h1", "http://site/", 1),
      received(200, true),
      { type: "finished", timestamp: 1.5 },
      sent("h2", "http://site/", 2),
      responseExtra(404),
    ])

    expect(hops(chain)).toMatchObject([{ statusCode: 200 }, { statusCode: 404 }])
  })

  test("the wire status wins over the renderer's in either order", () => {
    const before = replay([sent("h1", "http://site/", 1), responseExtra(304), received(200, true)])
    const after = replay([sent("h1", "http://site/", 1), received(200, true), responseExtra(304)])

    expect(hops(before)[0].statusCode).toBe(304)
    expect(hops(after)[0].statusCode).toBe(304)
  })
})

describe("settling", () => {
  test("a late failure does not overwrite a finished request", () => {
    const finished = replay([sent("h1", "http://site/", 1), received(200, false), { type: "finished", timestamp: 2 }])

    expect(transitionChain(finished, { type: "failed", timestamp: 3, errorText: "net::ERR_ABORTED" })).toBe(finished)
    expect(hops(finished)).toMatchObject([{ state: "completed", durationMs: 1_000 }])
  })

  test("a WebSocket error after its handshake does not touch the completed handshake", () => {
    // A frame error 45 s later used to turn the 101 into a failure lasting the whole socket's life.
    const open = replay([created, handshake, upgraded])
    expect(hops(open)).toMatchObject([{ state: "completed", statusCode: 101, durationMs: 500 }])

    expect(transitionChain(open, { type: "ws.error", timestamp: 46, message: "bad frame" })).toBe(open)
    expect(transitionChain(open, { type: "ws.closed", timestamp: 46.1 })).toBe(open)
  })

  test("a WebSocket that fails or closes before its handshake fails", () => {
    expect(hops(replay([created, handshake, { type: "ws.error", timestamp: 1.5, message: "refused" }]))).toMatchObject([
      { state: "failed", failure: "refused", durationMs: 500 },
    ])
    expect(hops(replay([created, { type: "ws.closed", timestamp: 2 }]))).toMatchObject([
      { state: "failed", failure: "Closed before the handshake completed", durationMs: 0 },
    ])
  })

  test("a detached frame fails its pending requests and drops ExtraInfo nobody will claim", () => {
    const pending = replay([sent("h1", "http://site/frame", 1), requestExtra({})])
    const detached = transitionChain(pending, { type: "detached" })

    expect(hops(detached)).toMatchObject([{ state: "failed", failure: "Frame detached before request completed" }])
    expect(detached?.hops[0].wire).toBe("none")

    if (!detached) throw new Error("No chain")
    expect(responseBody(detached.hops[0], true)).toEqual({ state: "unavailable", reason: "notCaptured" })
    expect(transitionChain(detached, { type: "detached" })).toBe(detached)
    expect(transitionChain(replay([requestExtra({})]), { type: "detached" })).toBeUndefined()
  })

  test("ExtraInfo for a request that ends unreported is dropped", () => {
    expect(replay([responseExtra(200), { type: "failed", timestamp: 1, errorText: "net::ERR_ABORTED" }])).toBeUndefined()
    expect(replay([requestExtra({}), { type: "finished", timestamp: 1 }])).toBeUndefined()
  })
})

describe("bounds", () => {
  test("queued ExtraInfo stops growing at the cap", () => {
    const full = replay(Array.from({ length: MAX_WIRE_QUEUE }, () => requestExtra({})))

    expect(full?.requestWire).toHaveLength(MAX_WIRE_QUEUE)
    expect(transitionChain(full, requestExtra({}))).toBe(full)
  })

  test("evicting the last hop forgets the request ID", () => {
    const chain = replay([sent("h1", "http://site/", 1), sent("h2", "http://site/", 2)])

    if (!chain) throw new Error("No chain")

    const rest = evictHop(chain, "h1")
    expect(rest?.hops.map((hop) => hop.id)).toEqual(["h2"])

    if (!rest) throw new Error("No chain")

    expect(evictHop(rest, "h2")).toBeUndefined()
  })
})
