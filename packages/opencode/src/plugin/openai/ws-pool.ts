import WebSocket from "ws"
import { ProviderError } from "@/provider/error"
import { isRecord } from "@/util/record"
import { OpenAIWebSocket } from "./ws"

export const TITLE_HEADER = "x-opencode-title"

export interface CreateWebSocketFetchOptions {
  httpFetch?: typeof globalThis.fetch
  url?: string
  connectTimeout?: number
  idleTimeout?: number
  maxConnectionAge?: number
  streamRetries?: number
}

interface PoolEntry {
  socket?: WebSocket
  connectedAt?: number
  lastUsedAt: number
  busy: boolean
  fallback: boolean
  streamFailures: number
}

const DEFAULT_CONNECT_TIMEOUT = 15_000
const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000
const DEFAULT_MAX_CONNECTION_AGE = 55 * 60 * 1000
const CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached"

export function createWebSocketFetch(options?: CreateWebSocketFetchOptions) {
  const httpFetch = options?.httpFetch ?? globalThis.fetch
  const pool = new Map<string, PoolEntry>()
  const connectTimeout = options?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
  const idleTimeout = options?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  const maxConnectionAge = options?.maxConnectionAge ?? DEFAULT_MAX_CONNECTION_AGE
  const streamRetries = options?.streamRetries ?? 5
  const pruneTimer = setInterval(() => prune(), Math.min(idleTimeout, 60_000))
  if (typeof pruneTimer === "object" && "unref" in pruneTimer && typeof pruneTimer.unref === "function") {
    pruneTimer.unref()
  }

  async function websocketFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
    const internalHeaders = OpenAIWebSocket.normalizeHeaders(init?.headers)
    const httpInit = withoutInternalHeaders(init)

    if (init?.method !== "POST" || !new URL(url).pathname.endsWith("/responses")) {
      return httpFetch(input, httpInit)
    }

    const body = (() => {
      try {
        if (typeof init?.body !== "string") return undefined
        const parsed = JSON.parse(init.body)
        return typeof parsed === "object" && parsed !== null ? parsed : undefined
      } catch {
        return undefined
      }
    })()
    if (!body?.stream) return httpFetch(input, httpInit)
    if (internalHeaders[TITLE_HEADER] === "true") {
      return httpFetch(input, httpInit)
    }

    const sessionID = internalHeaders["x-session-affinity"] ?? internalHeaders["session-id"]
    if (!sessionID) {
      return httpFetch(input, httpInit)
    }
    const key = `${sessionID}:conversation`

    const entry = pool.get(key) ?? { lastUsedAt: Date.now(), busy: false, fallback: false, streamFailures: 0 }
    pool.set(key, entry)

    if (entry.fallback) {
      return httpFetch(input, httpInit)
    }
    if (entry.busy) {
      return httpFetch(input, httpInit)
    }

    entry.busy = true
    entry.lastUsedAt = Date.now()
    try {
      entry.socket = await socket(
        entry,
        options?.url ?? url,
        OpenAIWebSocket.normalizeHeaders(httpInit?.headers),
        connectTimeout,
        maxConnectionAge,
        init?.signal,
      )
      let resolveFirstEvent: (event: boolean | OpenAIWebSocket.WrappedError) => void = () => {}
      let rejectFirstEvent: (error: Error) => void = () => {}
      const firstEvent = new Promise<boolean | OpenAIWebSocket.WrappedError>((resolve, reject) => {
        resolveFirstEvent = resolve
        rejectFirstEvent = reject
      })
      const response = OpenAIWebSocket.streamResponsesWebSocket({
        socket: entry.socket,
        body,
        idleTimeout,
        signal: init?.signal ?? undefined,
        onFirstEvent: (error) => resolveFirstEvent(error ?? true),
        onTerminal: (event) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          entry.streamFailures = 0
          if (event.type !== "response.completed" && event.type !== "response.done") {
            invalidate(entry)
          }
        },
        onConnectionInvalid: (error) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          if (!entry.fallback) recordStreamFailure(entry)
          invalidate(entry)
          resolveFirstEvent(false)
        },
        onAbort: (error) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          entry.streamFailures = 0
          invalidate(entry)
          rejectFirstEvent(error)
        },
        onRetryableTerminal: async (event) => {
          const error = connectionLimitError(event)
          if (!error) return undefined
          throw error
        },
      })
      const first = await firstEvent
      if (first !== false) {
        if (first === true || first.status < 200 || first.status > 599) return response
        return new Response(first.body, {
          status: first.status,
          headers: { "content-type": "application/json", ...first.headers },
        })
      }
      if (!entry.fallback) return response
      return httpFetch(input, httpInit)
    } catch (error) {
      entry.busy = false
      entry.lastUsedAt = Date.now()
      if (OpenAIWebSocket.isAbortError(error)) {
        entry.streamFailures = 0
        invalidate(entry)
        throw error
      }

      recordStreamFailure(entry)
      invalidate(entry)
      if (entry.fallback) return httpFetch(input, httpInit)
      return failedResponse(
        new ProviderError.ResponseStreamError(error instanceof Error ? error.message : String(error), {
          cause: error,
        }),
      )
    }
  }

  function recordStreamFailure(entry: PoolEntry) {
    entry.streamFailures++
    // Codex counts retries after the initial failed WebSocket attempt.
    if (entry.streamFailures > streamRetries) entry.fallback = true
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of pool) {
      if (entry.busy) continue
      if (entry.fallback) continue
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

  function remove(sessionID: string) {
    const key = `${sessionID}:conversation`
    const entry = pool.get(key)
    if (!entry) return
    invalidate(entry)
    pool.delete(key)
  }

  return Object.assign(websocketFetch, { close, remove })
}

function connectionLimitError(event: Record<string, unknown>) {
  if (event.type !== "error" || !isRecord(event.error) || event.error.code !== CONNECTION_LIMIT_REACHED_CODE) return
  return new Error(typeof event.error.message === "string" ? event.error.message : CONNECTION_LIMIT_REACHED_CODE)
}

function failedResponse(error: ProviderError.ResponseStreamError) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error)
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  )
}

async function socket(
  entry: PoolEntry,
  url: string,
  headers: Record<string, string>,
  connectTimeout: number,
  maxConnectionAge: number,
  signal?: AbortSignal | null,
) {
  if (
    entry.socket?.readyState === WebSocket.OPEN &&
    entry.connectedAt &&
    Date.now() - entry.connectedAt < maxConnectionAge
  ) {
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
    entry.socket.on("error", () => {})
    entry.socket.terminate()
    entry.socket = undefined
  }
  entry.connectedAt = undefined
}

export function withoutInternalHeaders<T extends { headers?: HeadersInit }>(init: T | undefined): T | undefined {
  if (!init?.headers) return init
  if (init.headers instanceof Headers) {
    const headers = new Headers(init.headers)
    headers.delete(TITLE_HEADER)
    return { ...init, headers }
  }

  if (Array.isArray(init.headers)) {
    return { ...init, headers: init.headers.filter((item) => item[0].toLowerCase() !== TITLE_HEADER) }
  }

  return {
    ...init,
    headers: Object.fromEntries(Object.entries(init.headers).filter(([key]) => key.toLowerCase() !== TITLE_HEADER)),
  }
}

export * as OpenAIWebSocketPool from "./ws-pool"
