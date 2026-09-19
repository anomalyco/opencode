import WebSocket from "ws"
import { createHash } from "node:crypto"
import { ProviderError } from "@/provider/error"
import { isRecord } from "@/util/record"
import { OpenAIWebSocket } from "./ws"

export const TITLE_HEADER = "x-opencode-title"

export interface CreateWebSocketFetchOptions {
  httpFetch?: typeof globalThis.fetch
  url?: string
  connectTimeout?: number
  idleTimeout?: number
  fallbackTimeout?: number
  maxConnectionAge?: number
  streamRetries?: number
  busyTimeout?: number
}

interface PoolEntry {
  sessionID: string
  socket?: WebSocket
  connectedAt?: number
  lastUsedAt: number
  busyAt: number
  busy: boolean
  fallback: boolean
  streamFailures: number
  backoff: number
  nextAttemptAt: number
}

const DEFAULT_CONNECT_TIMEOUT = 15_000
const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000
const DEFAULT_FALLBACK_TIMEOUT = 10 * 60 * 1000
const DEFAULT_MAX_CONNECTION_AGE = 55 * 60 * 1000
const CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached"
const MAX_POOL_SIZE = 32
const BACKOFF_BASE_MS = 25
const BACKOFF_MAX_MS = 5_000

export function createWebSocketFetch(options?: CreateWebSocketFetchOptions) {
  const httpFetch = options?.httpFetch ?? globalThis.fetch
  const pool = new Map<string, PoolEntry>()
  const connectTimeout = options?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT
  const idleTimeout = options?.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  const fallbackTimeout = options?.fallbackTimeout ?? DEFAULT_FALLBACK_TIMEOUT
  const maxConnectionAge = options?.maxConnectionAge ?? DEFAULT_MAX_CONNECTION_AGE
  const streamRetries = options?.streamRetries ?? 5
  const busyTimeout = options?.busyTimeout ?? Math.max(idleTimeout, 60_000)
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
    const socketURL = options?.url ?? url
    const authHeaders = OpenAIWebSocket.normalizeHeaders(httpInit?.headers)
    const key = `${sessionID}:${fingerprint(socketURL, authHeaders)}`

    const existing = pool.get(key)
    if (!existing && !admit()) return httpFetch(input, httpInit)
    const entry = existing ?? {
      sessionID,
      lastUsedAt: Date.now(),
      busyAt: 0,
      busy: false,
      fallback: false,
      streamFailures: 0,
      backoff: 0,
      nextAttemptAt: 0,
    }
    pool.set(key, entry)

    if (entry.fallback) {
      return httpFetch(input, httpInit)
    }
    if (entry.busy) {
      return httpFetch(input, httpInit)
    }
    entry.busy = true
    entry.busyAt = Date.now()
    entry.lastUsedAt = Date.now()
    try {
      // Back off after a failed attempt so a struggling endpoint is not hammered with
      // immediate reconnects (which worsens `websocket_connection_limit_reached`).
      // Reserve the lane before yielding, or a concurrent caller can admit a second
      // connection for this key while the delay is pending.
      await waitForBackoff(entry, init?.signal)
      if (entry.fallback) {
        entry.busy = false
        return httpFetch(input, httpInit)
      }
      entry.socket = await socket(entry, socketURL, authHeaders, connectTimeout, maxConnectionAge, init?.signal)
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
          resetBackoff(entry)
          if (event.type !== "response.completed" && event.type !== "response.done") {
            invalidate(entry)
          }
        },
        onConnectionInvalid: (_error, closeCode) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          if (closeCode === OpenAIWebSocket.MESSAGE_TOO_BIG_CLOSE_CODE) entry.fallback = true
          else if (!entry.fallback) recordStreamFailure(entry)
          invalidate(entry)
          resolveFirstEvent(false)
        },
        onAbort: (error) => {
          entry.busy = false
          entry.lastUsedAt = Date.now()
          entry.streamFailures = 0
          resetBackoff(entry)
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
        resetBackoff(entry)
        if (first === true || first.status < 200 || first.status > 599) return withActivity(entry, response)
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
    entry.backoff = entry.backoff === 0 ? BACKOFF_BASE_MS : Math.min(entry.backoff * 2, BACKOFF_MAX_MS)
    entry.nextAttemptAt = Date.now() + entry.backoff + Math.floor(Math.random() * entry.backoff)
    // Codex counts retries after the initial failed WebSocket attempt.
    if (entry.streamFailures > streamRetries) entry.fallback = true
  }

  function resetBackoff(entry: PoolEntry) {
    entry.backoff = 0
    entry.nextAttemptAt = 0
  }

  // Bound total entries, not just idle ones: when every slot is busy the caller
  // falls back to HTTP instead of growing the pool without limit.
  function admit() {
    while (pool.size >= MAX_POOL_SIZE) {
      const candidate = [...pool]
        .filter(([, entry]) => !entry.busy)
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]
      if (!candidate) return false
      invalidate(candidate[1])
      pool.delete(candidate[0])
    }
    return true
  }

  function prune() {
    const now = Date.now()
    for (const [key, entry] of pool) {
      // A caller that drops the response without reading or cancelling never fires
      // `onTerminal`/`onAbort`, so reclaim a slot that has been busy far longer than
      // any real stream. Do not reclaim while a backoff is pending or during a
      // shorter-configured idle window.
      if (entry.busy && (entry.nextAttemptAt > now || now - entry.busyAt < busyTimeout)) continue
      if (entry.busy) {
        entry.busy = false
        invalidate(entry)
      }
      // Keep the retry budget and backoff state while a reconnect is pending.
      if (entry.nextAttemptAt > now) continue
      if (now - entry.lastUsedAt < (entry.fallback ? fallbackTimeout : idleTimeout)) continue
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
    for (const [key, entry] of pool) {
      if (entry.sessionID !== sessionID) continue
      invalidate(entry)
      pool.delete(key)
    }
  }

  return Object.assign(websocketFetch, { close, remove, prune })
}

function waitForBackoff(entry: PoolEntry, signal?: AbortSignal | null) {
  const remaining = entry.nextAttemptAt - Date.now()
  if (remaining <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, remaining)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

// Key on a 256-bit digest, not a 32-bit FNV-1a: two callers sharing a sessionID
// with different bearer tokens must never collide and reuse each other's socket.
function fingerprint(url: string, headers: Record<string, string>) {
  const hash = createHash("sha256")
  hash.update(url)
  for (const key of Object.keys(headers).sort()) hash.update(`\u0000${key}:${headers[key]}`)
  return hash.digest("hex")
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

// Refresh the prune clock as the consumer reads data, so prune only reclaims a lane that
// has genuinely stalled (the caller stopped reading). Without this a legitimate stream
// longer than `busyTimeout` is terminated mid-flight (v8 NEW-06).
function withActivity(entry: PoolEntry, response: Response): Response {
  if (!response.body) return response
  const reader = response.body.getReader()
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        entry.busyAt = Date.now()
        controller.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    }),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  )
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
