/**
 * WebSocket transport for the OpenAI Responses API.
 *
 * Instead of one HTTP request per response.create, this module keeps a
 * persistent WebSocket connection and multiplexes requests over it. The
 * main win is eliminating the TLS + HTTP round-trip on every tool-call
 * continuation within a single session.
 *
 * ## Codex vs OpenAI differences
 *
 * - **Terminal event**: OpenAI sends `response.completed`; Codex sends
 *   `response.done`. Both carry `{ response: { id, output, … } }`.
 * - **`store` field**: Codex requires `store=false` (or omitted). Sending
 *   `store=true` immediately closes the connection with code 1008.
 * - **`previous_response_id`**: Works on both endpoints for plain-text
 *   continuations on the same connection. However, Codex returns
 *   `server_error` when combining `previous_response_id` with
 *   `function_call_output` input items — this works fine on regular
 *   OpenAI. Until Codex fixes this, incremental input trimming is only
 *   useful for non-tool-calling turns.
 *
 * ## Connection lifecycle
 *
 * After a response completes the connection is kept alive (idle timeout
 * 90 s). When `OPENCODE_EXPERIMENTAL_WS_INCREMENTAL` is off, we
 * proactively close and reopen the socket because the Codex endpoint
 * rejects a second `response.create` on the same connection. When the
 * flag is on we keep the socket so `previous_response_id` can reference
 * the in-memory response cache.
 */
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "provider.websocket" })

/** Behavioral differences between OpenAI and Codex WebSocket endpoints. */
type Dialect = {
  /** Codex rejects previous_response_id + function_call_output with server_error. */
  skipIncrementalOnToolOutput: boolean
  /** Codex rejects a second response.create on the same connection (non-incremental mode). */
  reconnectAfterResponse: boolean
}

const DIALECT_CODEX: Dialect = {
  skipIncrementalOnToolOutput: true,
  reconnectAfterResponse: true,
}

const DIALECT_OPENAI: Dialect = {
  skipIncrementalOnToolOutput: false,
  reconnectAfterResponse: false,
}

function detectDialect(url: URL): Dialect {
  return url.hostname === "chatgpt.com" ? DIALECT_CODEX : DIALECT_OPENAI
}

type Entry = {
  key: string
  sessionID: string
  url: string
  headers: Headers
  ws?: WebSocket
  opening?: Promise<WebSocket>
  active: boolean
  idleTimer?: Timer
  // previous_response_id tracking (when OPENCODE_EXPERIMENTAL_WS_INCREMENTAL is on)
  lastResponseId?: string
  lastInputLength?: number
  lastOutputLength?: number
}

type Store = {
  entries: Map<string, Entry>
  sessions: Map<string, Set<string>>
}

const IDLE_MS = 90_000
const encoder = new TextEncoder()

function parseBody(body: RequestInit["body"]): Record<string, unknown> | undefined {
  if (typeof body !== "string") return
  try {
    return JSON.parse(body)
  } catch {
    return
  }
}

const WS_PROTOCOLS: Record<string, string> = { "https:": "wss:", "http:": "ws:" }

function toWebSocketURL(input: URL): string {
  const wsProtocol = WS_PROTOCOLS[input.protocol]
  if (!wsProtocol) return input.toString()
  return `${wsProtocol}//${input.host}${input.pathname}${input.search}`
}

function messageDataToString(data: MessageEvent["data"]): string {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
  return String(data)
}

// OpenAI uses `response.completed`; Codex uses `response.done`.
// Both carry `{ response: { id, output, ... } }` on success.
const TERMINAL_TYPES = new Set(["response.completed", "response.done", "response.failed", "error"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function clearIdleTimer(entry: Entry): void {
  if (!entry.idleTimer) return
  clearTimeout(entry.idleTimer)
  entry.idleTimer = undefined
}

function scheduleIdleClose(store: Store, entry: Entry): void {
  const timer = setTimeout(() => closeEntry(store, entry.key), IDLE_MS)
  if (typeof timer === "object") timer.unref?.()
  entry.idleTimer = timer
}

function toURL(request: RequestInfo | URL): URL {
  if (request instanceof Request) return new URL(request.url)
  return new URL(request)
}

function resetEntry(entry: Entry): void {
  entry.active = false
  entry.opening = undefined
  entry.lastResponseId = undefined
  entry.lastInputLength = undefined
  entry.lastOutputLength = undefined
  clearIdleTimer(entry)
  entry.ws?.close()
  entry.ws = undefined
}

function closeStore(store: Store): void {
  for (const entry of store.entries.values()) {
    resetEntry(entry)
  }
  store.entries.clear()
  store.sessions.clear()
}

const state = Instance.state(
  () => ({
    entries: new Map<string, Entry>(),
    sessions: new Map<string, Set<string>>(),
  }),
  async (store) => {
    closeStore(store)
  },
)

function unlink(store: Store, entry: Entry): void {
  const set = store.sessions.get(entry.sessionID)
  if (!set) return
  set.delete(entry.key)
  if (set.size === 0) store.sessions.delete(entry.sessionID)
}

function closeEntry(store: Store, key: string): void {
  const entry = store.entries.get(key)
  if (!entry) return
  resetEntry(entry)
  unlink(store, entry)
  store.entries.delete(key)
}

function upsertEntry(
  store: Store,
  input: {
    key: string
    sessionID: string
    url: string
    headers: Headers
  },
): Entry {
  const existing = store.entries.get(input.key)
  if (existing) return existing

  const entry: Entry = {
    key: input.key,
    sessionID: input.sessionID,
    url: input.url,
    headers: input.headers,
    active: false,
  }
  store.entries.set(input.key, entry)

  const set = store.sessions.get(input.sessionID) ?? new Set<string>()
  set.add(input.key)
  store.sessions.set(input.sessionID, set)

  return entry
}

function key(input: { sessionID: string; url: URL; headers: Headers }): string {
  const auth = input.headers.get("authorization") ?? ""
  const account = input.headers.get("chatgpt-account-id") ?? ""
  const org = input.headers.get("openai-organization") ?? ""
  const project = input.headers.get("openai-project") ?? ""
  return Bun.hash
    .xxHash32([input.sessionID, input.url.origin, input.url.pathname, auth, account, org, project].join("\x1f"))
    .toString()
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("aborted", "AbortError")
}

function connectWithAbort(entry: Entry, signal?: AbortSignal | null): Promise<WebSocket> {
  if (!signal) return connect(entry)
  if (signal.aborted) return Promise.reject(abortError(signal))

  return new Promise<WebSocket>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener("abort", onAbort, { once: true })
    connect(entry).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}

async function connect(entry: Entry): Promise<WebSocket> {
  if (entry.ws?.readyState === WebSocket.OPEN) return entry.ws
  if (entry.opening) return entry.opening

  const ws = new WebSocket(entry.url, {
    headers: Object.fromEntries(entry.headers.entries()),
  } as unknown as string[])

  const opening = new Promise<WebSocket>((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener("open", onOpen)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
    }

    const onOpen = () => {
      cleanup()
      ws.addEventListener("close", () => {
        if (entry.ws !== ws) return
        entry.ws = undefined
        entry.opening = undefined
        entry.active = false
      })
      entry.ws = ws
      entry.opening = undefined
      resolve(ws)
    }

    const onError = () => {
      cleanup()
      entry.opening = undefined
      reject(new Error("websocket open failed"))
    }

    const onClose = () => {
      cleanup()
      entry.opening = undefined
      reject(new Error("websocket closed before open"))
    }

    ws.addEventListener("open", onOpen)
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)
  })

  entry.opening = opening
  return opening
}

export namespace OpenAIWebSocket {
  export async function stream(input: { request: RequestInfo | URL; init?: RequestInit }): Promise<Response | undefined> {
    const method = (
      input.init?.method ?? (input.request instanceof Request ? input.request.method : "GET")
    ).toUpperCase()
    if (method !== "POST") return

    const url = toURL(input.request)
    if (!url.pathname.endsWith("/responses")) return

    const body = parseBody(input.init?.body)
    if (!body) return
    if (body.stream !== true) return
    if (!("input" in body) && !("previous_response_id" in body)) return

    const headers = new Headers(input.request instanceof Request ? input.request.headers : undefined)
    if (input.init?.headers) {
      const patched = new Headers(input.init.headers)
      patched.forEach((value, name) => headers.set(name, value))
    }
    const sessionID = headers.get("session_id") ?? headers.get("x-opencode-session") ?? "default"
    const k = key({
      sessionID,
      url,
      headers,
    })
    const store = state()
    const sessionKeys = store.sessions.get(sessionID)
    if (sessionKeys) {
      for (const item of [...sessionKeys]) {
        if (item === k) continue
        closeEntry(store, item)
      }
    }

    const entry = upsertEntry(store, {
      key: k,
      sessionID,
      url: toWebSocketURL(url),
      headers,
    })

    if (entry.active) {
      log.info("skip", { reason: "active", sessionID })
      return
    }

    clearIdleTimer(entry)

    const reused = entry.ws?.readyState === WebSocket.OPEN
    const signal = input.init?.signal
    const ws = await connectWithAbort(entry, signal).catch((error) => {
      log.info("connect failed", { sessionID, error: String(error) })
      closeEntry(store, entry.key)
      if (signal?.aborted) throw error
      return undefined
    })
    if (!ws) {
      log.info("skip", { reason: "no-ws", sessionID })
      return
    }
    log.info("connected", { sessionID, reused, readyState: ws.readyState })

    const payload: Record<string, unknown> = {
      ...body,
      type: "response.create",
    }
    delete payload.stream
    delete payload.background

    // When incremental mode is on and we have a previous response on this
    // connection, trim the input array to only the new messages and set
    // previous_response_id so the server uses its in-memory history.
    const incremental = Flag.OPENCODE_EXPERIMENTAL_WS_INCREMENTAL
    const dialect = detectDialect(url)
    const fullInputLength = Array.isArray(payload.input) ? payload.input.length : 0
    if (incremental && entry.lastResponseId && Array.isArray(payload.input)) {
      const skip = (entry.lastInputLength ?? 0) + (entry.lastOutputLength ?? 0)
      if (skip > 0 && skip < payload.input.length) {
        const nextInput = payload.input.slice(skip)
        const hasToolOutput =
          dialect.skipIncrementalOnToolOutput && nextInput.some((item: any) => item.type === "function_call_output")
        if (!hasToolOutput) {
          payload.input = nextInput
          payload.previous_response_id = entry.lastResponseId
          log.info("incremental", {
            sessionID,
            previousResponseId: entry.lastResponseId,
            skipped: skip,
            remaining: nextInput.length,
          })
        }
      }
    }

    log.info("send", {
      sessionID,
      model: payload.model,
      hasPreviousResponseId: !!payload.previous_response_id,
      inputLength: Array.isArray(payload.input) ? payload.input.length : 0,
    })
    entry.active = true

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let done = false

        const release = (closeSocket: boolean) => {
          if (done) return
          done = true
          log.info("release", { sessionID, closeSocket })
          entry.active = false
          ws.removeEventListener("message", onMessage)
          ws.removeEventListener("error", onError)
          ws.removeEventListener("close", onClose)
          signal?.removeEventListener("abort", onAbort)
          if (closeSocket) {
            closeEntry(store, entry.key)
          } else if (payload.previous_response_id || !dialect.reconnectAfterResponse) {
            scheduleIdleClose(store, entry)
          } else {
            entry.ws = undefined
            ws.close()
            connect(entry).catch(() => {})
            scheduleIdleClose(store, entry)
          }
        }

        const onMessage = (event: MessageEvent) => {
          if (done) return
          const value = messageDataToString(event.data)
          let parsed: unknown
          try {
            parsed = JSON.parse(value)
          } catch {
            return
          }
          if (!isRecord(parsed)) return

          const type = parsed.type
          if (type === "error") {
            log.info("message", { sessionID, type, error: parsed.error })
          } else {
            log.info("message", { sessionID, type })
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`))
          if (typeof type !== "string" || !TERMINAL_TYPES.has(type)) return

          // Only update incremental state on success; clear on error so
          // the next retry sends the full input instead of a stale ref.
          if (incremental) {
            if (type === "response.completed" || type === "response.done") {
              const response = parsed.response
              if (isRecord(response)) {
                entry.lastResponseId = response.id as string | undefined
                entry.lastInputLength = fullInputLength
                entry.lastOutputLength = Array.isArray(response.output) ? response.output.length : 0
              }
            } else {
              entry.lastResponseId = undefined
              entry.lastInputLength = undefined
              entry.lastOutputLength = undefined
            }
          }
          log.info("terminal", { sessionID, type })
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          const closeSocket =
            type === "error" && isRecord(parsed.error) && parsed.error.code === "websocket_connection_limit_reached"
          release(closeSocket)
          controller.close()
        }

        const onError = () => {
          if (done) return
          log.info("error", { sessionID })
          release(true)
          controller.error(new Error("websocket error"))
        }

        const onClose = () => {
          if (done) return
          log.info("closed", { sessionID })
          release(true)
          controller.error(new Error("websocket closed"))
        }

        const onAbort = () => {
          if (done) return
          log.info("abort", { sessionID })
          release(true)
          controller.error(abortError(signal!))
        }

        ws.addEventListener("message", onMessage)
        ws.addEventListener("error", onError)
        ws.addEventListener("close", onClose)

        if (signal) {
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener("abort", onAbort)
        }

        ws.send(JSON.stringify(payload))
      },
      cancel() {
        closeEntry(store, entry.key)
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    })
  }

  export function closeSession(sessionID: string): void {
    const store = state()
    const keys = store.sessions.get(sessionID)
    if (!keys) return
    for (const key of [...keys]) {
      closeEntry(store, key)
    }
  }

  export function closeAll(): void {
    closeStore(state())
  }
}
