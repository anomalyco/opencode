import WebSocket from "ws"
import { OpenAIWebSocket } from "./ws"

export const TITLE_HEADER = "x-opencode-title"

export interface CreateWebSocketFetchOptions {
  httpFetch?: typeof globalThis.fetch
  url?: string
  connectTimeout?: number
  idleTimeout?: number
  maxConnectionAge?: number
}

interface PoolEntry {
  socket?: WebSocket
  connectedAt?: number
  lastUsedAt: number
  busy: boolean
  fallback: boolean
}

const DEFAULT_CONNECT_TIMEOUT = 10_000
const DEFAULT_IDLE_TIMEOUT = 10 * 60 * 1000
const DEFAULT_MAX_CONNECTION_AGE = 55 * 60 * 1000

export function createWebSocketFetch(options?: CreateWebSocketFetchOptions) {
  const httpFetch = options?.httpFetch ?? globalThis.fetch
  const pool = new Map<string, PoolEntry>()
  const connectTimeout = options?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
  const idleTimeout = options?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  const maxConnectionAge = options?.maxConnectionAge ?? DEFAULT_MAX_CONNECTION_AGE
  const pruneTimer = setInterval(() => prune(), Math.min(idleTimeout, 60_000))
  if (typeof pruneTimer === "object" && "unref" in pruneTimer && typeof pruneTimer.unref === "function") {
    pruneTimer.unref()
  }

  async function websocketFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input)
    const internalHeaders = OpenAIWebSocket.normalizeHeaders(init?.headers)
    const httpInit = withoutInternalHeaders(init)

    if (init?.method !== "POST" || !new URL(url).pathname.endsWith("/responses")) {
      return httpFetch(input, httpInit)
    }

    const body = parseBody(init?.body)
    if (!body?.stream) return httpFetch(input, httpInit)
    if (internalHeaders[TITLE_HEADER] === "true") {
      return httpFetch(input, httpInit)
    }

    const key = poolKey(internalHeaders)
    const entry = pool.get(key) ?? { lastUsedAt: Date.now(), busy: false, fallback: false }
    pool.set(key, entry)

    if (entry.fallback || entry.busy) return httpFetch(input, httpInit)

    try {
      entry.socket = await socket(
        entry,
        options?.url ?? url,
        OpenAIWebSocket.normalizeHeaders(httpInit?.headers),
        connectTimeout,
        maxConnectionAge,
        init?.signal,
      )
      entry.busy = true
      entry.lastUsedAt = Date.now()
      return OpenAIWebSocket.streamResponsesWebSocket({
        socket: entry.socket,
        body,
        signal: init?.signal ?? undefined,
        onTerminal: (event) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          if (event.type !== "response.completed") invalidate(entry)
        },
        onConnectionInvalid: () => {
          entry.busy = false
          entry.fallback = true
          invalidate(entry)
        },
      })
    } catch {
      entry.fallback = true
      invalidate(entry)
      return httpFetch(input, httpInit)
    }
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of pool) {
      if (entry.busy) continue
      if (now - entry.lastUsedAt < idleTimeout) continue
      invalidate(entry)
      pool.delete(key)
    }
  }

  function close() {
    clearInterval(pruneTimer)
    for (const entry of pool.values()) invalidate(entry)
    pool.clear()
  }

  return Object.assign(websocketFetch, { close })
}

async function socket(
  entry: PoolEntry,
  url: string,
  headers: Record<string, string>,
  connectTimeout: number,
  maxConnectionAge: number,
  signal?: AbortSignal | null,
) {
  if (entry.socket?.readyState === WebSocket.OPEN && entry.connectedAt && Date.now() - entry.connectedAt < maxConnectionAge) {
    return entry.socket
  }

  invalidate(entry)
  const next = await OpenAIWebSocket.connectResponsesWebSocket({
    url: OpenAIWebSocket.toWebSocketUrl(url),
    headers,
    timeout: connectTimeout,
    signal: signal ?? undefined,
  })
  entry.connectedAt = Date.now()
  return next
}

function invalidate(entry: PoolEntry) {
  if (entry.socket) {
    entry.socket.terminate()
    entry.socket = undefined
  }
  entry.connectedAt = undefined
}

function poolKey(headers: Record<string, string>) {
  return [
    headers["x-session-affinity"] ?? headers["session_id"] ?? "global",
    headers[TITLE_HEADER] === "true" ? "title" : "conversation",
  ].join(":")
}

export function withoutInternalHeaders<T extends { headers?: HeadersInit }>(init: T | undefined): T | undefined {
  if (!init?.headers) return init
  return {
    ...init,
    headers: stripInternalHeaders(init.headers),
  }
}

function stripInternalHeaders(headers: HeadersInit): HeadersInit {
  if (headers instanceof Headers) {
    const next = new Headers(headers)
    next.delete(TITLE_HEADER)
    return next
  }

  if (Array.isArray(headers)) return headers.filter((item) => !isInternalHeader(item[0]))
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !isInternalHeader(key)))
}

function isInternalHeader(key: string) {
  return key.toLowerCase() === TITLE_HEADER
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> | undefined {
  try {
    if (typeof body !== "string") return undefined
    const parsed = JSON.parse(body)
    return typeof parsed === "object" && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

export * as OpenAIWebSocketPool from "./ws-pool"
