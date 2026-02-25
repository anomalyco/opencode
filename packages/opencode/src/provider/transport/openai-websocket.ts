import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "provider.websocket" })

type Entry = {
  key: string
  sessionID: string
  url: string
  headers: Headers
  ws?: WebSocket
  opening?: Promise<WebSocket>
  active: boolean
  idleTimer?: Timer
}

type Store = {
  entries: Map<string, Entry>
  sessions: Map<string, Set<string>>
}

function parseBody(body: RequestInit["body"]) {
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

function messageDataToString(data: MessageEvent["data"]) {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
  return String(data)
}

const TERMINAL_TYPES = new Set(["response.completed", "response.done", "response.incomplete", "response.failed", "error"])

function resetEntry(entry: Entry) {
  entry.active = false
  entry.opening = undefined
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }
  entry.ws?.close()
  entry.ws = undefined
}

function closeStore(store: Store) {
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

function unlink(store: Store, entry: Entry) {
  const set = store.sessions.get(entry.sessionID)
  if (!set) return
  set.delete(entry.key)
  if (set.size === 0) store.sessions.delete(entry.sessionID)
}

function closeEntry(store: Store, key: string) {
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
) {
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

function key(input: { sessionID: string; url: URL; headers: Headers }) {
  const auth = input.headers.get("authorization") ?? ""
  const account = input.headers.get("chatgpt-account-id") ?? ""
  const org = input.headers.get("openai-organization") ?? ""
  const project = input.headers.get("openai-project") ?? ""
  return Bun.hash
    .xxHash32([input.sessionID, input.url.origin, input.url.pathname, auth, account, org, project].join("\x1f"))
    .toString()
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("aborted", "AbortError")
}

function connectWithAbort(entry: Entry, signal?: AbortSignal | null) {
  if (!signal) return connect(entry)
  if (signal.aborted) return Promise.reject(abortError(signal))

  return new Promise<WebSocket>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(abortError(signal))
    }

    signal.addEventListener("abort", onAbort)
    connect(entry).then(
      (ws) => {
        signal.removeEventListener("abort", onAbort)
        resolve(ws)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

async function connect(entry: Entry) {
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
  export async function stream(input: { request: RequestInfo | URL; init?: RequestInit }) {
    const method = (
      input.init?.method ?? (input.request instanceof Request ? input.request.method : "GET")
    ).toUpperCase()
    if (method !== "POST") return

    const url = new URL(
      input.request instanceof URL
        ? input.request.toString()
        : typeof input.request === "string"
          ? input.request
          : input.request.url,
    )
    if (!url.pathname.endsWith("/responses")) return

    const body = parseBody(input.init?.body)
    if (!body || typeof body !== "object") return
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

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }

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

    const payload = {
      ...body,
      type: "response.create",
    }
    delete payload.stream
    delete payload.background

    log.info("send", {
      sessionID,
      model: payload.model,
      hasPreviousResponseId: !!payload.previous_response_id,
      inputLength: Array.isArray(payload.input) ? payload.input.length : 0,
      keys: Object.keys(payload),
    })
    entry.active = true
    const encoder = new TextEncoder()
    const idleMs = 90_000

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
          } else {
            // OpenAI's WebSocket server rejects the first `response.create` sent
            // on a connection that already completed a response (same connection,
            // after `response.done`). Rather than eating the ~200ms error+retry
            // penalty on every continuation, we close the old socket and open a
            // fresh one in the background so it's ready by the next request.
            entry.ws = undefined
            ws.close()
            connect(entry).catch(() => {})
            const timer = setTimeout(() => closeEntry(store, entry.key), idleMs)
            if (typeof timer === "object") timer.unref?.()
            entry.idleTimer = timer
          }
        }

        const onMessage = (event: MessageEvent) => {
          if (done) return
          const value = messageDataToString(event.data)
          let json: any
          try {
            json = JSON.parse(value)
          } catch {
            return
          }

          if (json.type === "error") {
            log.info("message", { sessionID, type: json.type, error: json.error })
          } else {
            log.info("message", { sessionID, type: json.type })
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(json)}\n\n`))
          if (!TERMINAL_TYPES.has(json.type)) return
          log.info("terminal", { sessionID, type: json.type })
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          const closeSocket = json.type === "error" && json.error?.code === "websocket_connection_limit_reached"
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

  export function closeSession(sessionID: string) {
    const store = state()
    const keys = store.sessions.get(sessionID)
    if (!keys) return
    for (const key of [...keys]) {
      closeEntry(store, key)
    }
  }

  export function closeAll() {
    closeStore(state())
  }
}
