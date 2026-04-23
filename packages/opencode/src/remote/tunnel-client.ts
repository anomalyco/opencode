import type { TunnelFrame } from "@opencode-ai/relay/protocol"
import type { Hono } from "hono"
import { Log } from "../util"

const log = Log.create({ service: "remote-tunnel" })

export type TunnelClientOptions = {
  relayUrl: string
  tunnelToken: string
  app: Hono
  /**
   * Basic-auth credentials that the local Hono `AuthMiddleware` expects when
   * `OPENCODE_SERVER_PASSWORD` is set. The tunnel client injects these on every
   * forwarded request so remote callers don't have to know the local password.
   */
  localAuth?: { username: string; password: string }
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void
  signal?: AbortSignal
}

/**
 * Opens an outbound WebSocket to the relay, reads tunnel frames, dispatches
 * each HTTP request against the local Hono app via `app.fetch`, and streams
 * the response back as a sequence of `http_chunk` frames. Reconnects with
 * exponential backoff if the socket drops.
 */
export async function runTunnelClient(opts: TunnelClientOptions): Promise<void> {
  const url = toWebSocketUrl(opts.relayUrl, "/tunnel", { token: opts.tunnelToken })

  let attempt = 0
  while (!opts.signal?.aborted) {
    opts.onStatus?.("connecting")
    try {
      await connectOnce(url, opts)
      attempt = 0
    } catch (err) {
      log.warn("tunnel session ended", { error: String(err) })
    }
    opts.onStatus?.("disconnected")
    if (opts.signal?.aborted) return
    const delay = Math.min(60_000, 1_000 * 2 ** attempt)
    attempt += 1
    await sleep(delay, opts.signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function connectOnce(url: string, opts: TunnelClientOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    const abortControllers = new Map<string, AbortController>()
    let keepalive: ReturnType<typeof setInterval> | undefined

    const send = (frame: TunnelFrame) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
    }

    const onAbort = () => {
      try {
        ws.close(1000, "client aborted")
      } catch {}
    }

    opts.signal?.addEventListener("abort", onAbort, { once: true })

    ws.onopen = () => {
      opts.onStatus?.("connected")
      keepalive = setInterval(() => send({ type: "ping" }), 25_000)
    }

    ws.onmessage = (event) => {
      void handleFrame(event, opts.app, send, abortControllers, opts.localAuth)
    }

    ws.onerror = () => {
      // onclose will follow; let it settle the promise.
    }

    ws.onclose = (event) => {
      if (keepalive) clearInterval(keepalive)
      opts.signal?.removeEventListener("abort", onAbort)
      for (const controller of abortControllers.values()) controller.abort()
      abortControllers.clear()
      if (event.code === 4401) reject(new Error("unauthorized (token expired?)"))
      else resolve()
    }
  })
}

async function handleFrame(
  event: MessageEvent,
  app: Hono,
  send: (frame: TunnelFrame) => void,
  aborts: Map<string, AbortController>,
  localAuth?: { username: string; password: string },
) {
  let frame: TunnelFrame
  try {
    frame = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)) as TunnelFrame
  } catch {
    return
  }
  if (frame.type === "ping") {
    send({ type: "pong" })
    return
  }
  if (frame.type === "pong") return
  if (frame.type === "abort") {
    aborts.get(frame.id)?.abort()
    aborts.delete(frame.id)
    return
  }
  if (frame.type !== "http_request") return

  const controller = new AbortController()
  aborts.set(frame.id, controller)

  const headers = new Headers(frame.headers)
  if (localAuth) {
    const credentials = btoa(`${localAuth.username}:${localAuth.password}`)
    headers.set("authorization", `Basic ${credentials}`)
  }
  let body: BodyInit | undefined
  if (frame.body != null) {
    if (frame.bodyEncoding === "base64") {
      body = Uint8Array.from(atob(frame.body), (c) => c.charCodeAt(0))
    } else {
      body = frame.body
    }
  }

  const origin = "http://opencode.internal"
  const request = new Request(origin + frame.path, {
    method: frame.method,
    headers,
    body,
    signal: controller.signal,
  })

  let response: Response
  try {
    response = await app.fetch(request)
  } catch (err) {
    send({ id: frame.id, type: "http_error", message: err instanceof Error ? err.message : String(err) })
    aborts.delete(frame.id)
    return
  }

  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  send({ id: frame.id, type: "http_response_head", status: response.status, headers: responseHeaders })

  if (!response.body) {
    send({ id: frame.id, type: "http_end" })
    aborts.delete(frame.id)
    return
  }

  const reader = response.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      send({ id: frame.id, type: "http_chunk", data: u8ToBase64(value), encoding: "base64" })
    }
    send({ id: frame.id, type: "http_end" })
  } catch (err) {
    send({ id: frame.id, type: "http_error", message: err instanceof Error ? err.message : String(err) })
  } finally {
    aborts.delete(frame.id)
  }
}

function u8ToBase64(bytes: Uint8Array): string {
  let bin = ""
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

function toWebSocketUrl(base: string, path: string, query?: Record<string, string>): string {
  const url = new URL(base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = (url.pathname.replace(/\/$/, "") + path).replace(/\/+/g, "/")
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return url.toString()
}
