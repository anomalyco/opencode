export * as BrowserProxy from "./proxy.js"

import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  Agent,
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { Duplex } from "node:stream"
import { Schema } from "effect"
import { BrowserProxyMachine } from "./proxy-machine.js"
import { Browser } from "./rpc.js"

/** Legacy chunked RPC transport. */
export type Transport = {
  open(target: Browser.TunnelTarget, signal: AbortSignal): Promise<string>
  read(id: string, signal: AbortSignal): Promise<Browser.TunnelRead>
  write(id: string, data: Uint8Array, end: boolean, signal: AbortSignal): Promise<void>
  close(id: string): Promise<void>
}

/** Streaming duplex transport backed by the prewarmed binary WebSocket multiplexer. */
export type StreamTransport = {
  openStream(target: Browser.TunnelTarget, signal: AbortSignal): Promise<Duplex>
  /** Optional hook invoked when the underlying tunnel disconnects so idle pooled sockets are evicted immediately. */
  onReset?(listener: () => void): () => void
}

export type ProxyTransport = Transport | StreamTransport
export type Proxy = Awaited<ReturnType<typeof make>>

const MAX_POOLED_ORIGINS = 64
const MAX_SOCKETS_PER_ORIGIN = 8
const MAX_FREE_SOCKETS_PER_ORIGIN = 6
const IDLE_POOL_SOCKET_TIMEOUT_MS = 30_000

function isStreamTransport(transport: ProxyTransport): transport is StreamTransport {
  return "openStream" in transport
}

// Desktop-only leaf. This listener is never loaded by the server plugin.
export async function make(transport: ProxyTransport) {
  const username = randomBytes(16).toString("hex")
  const password = randomBytes(32).toString("hex")
  const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  const clients = new Set<Duplex>()
  const tunnels = new Set<Duplex>()
  const pending = new Set<AbortController>()
  const originPools = new Map<string, Agent>()
  const closed = Promise.withResolvers<void>()
  let state = BrowserProxyMachine.initial

  const authorized = (value: string | undefined) => {
    if (!value) return false
    const actual = Buffer.from(value)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  const connect = async (destination: Browser.TunnelTarget, signal: AbortSignal) => {
    if (!BrowserProxyMachine.admits(state)) throw new Error("Browser proxy is closed")
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    pending.add(abort)
    try {
      const socket = isStreamTransport(transport)
        ? await transport.openStream(destination, abort.signal)
        : new TunnelSocket(transport, await transport.open(destination, abort.signal))
      if (!BrowserProxyMachine.admits(state) || abort.signal.aborted) {
        socket.destroy()
        throw new Error("Browser proxy connection was cancelled")
      }
      tunnels.add(socket)
      socket.once("close", () => tunnels.delete(socket))
      return socket
    } finally {
      pending.delete(abort)
      signal.removeEventListener("abort", cancel)
    }
  }

  const clearPools = () => {
    for (const agent of originPools.values()) agent.destroy()
    originPools.clear()
  }

  const offReset = isStreamTransport(transport) ? transport.onReset?.(clearPools) : undefined

  /**
   * Returns a per-origin HTTP/1.1 keep-alive Agent scoped strictly to this attachment's proxy.
   * Each origin key is canonicalized `host:port`; sockets are never shared across origins or attachments.
   */
  const agentForOrigin = (destination: Browser.TunnelTarget) => {
    const key = `${destination.host.toLowerCase()}:${destination.port}`
    const existing = originPools.get(key)
    if (existing) {
      // Refresh LRU order.
      originPools.delete(key)
      originPools.set(key, existing)
      return existing
    }
    if (originPools.size >= MAX_POOLED_ORIGINS) {
      const oldest = originPools.keys().next().value
      if (oldest !== undefined) {
        originPools.get(oldest)?.destroy()
        originPools.delete(oldest)
      }
    }
    const agent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 15_000,
      maxSockets: MAX_SOCKETS_PER_ORIGIN,
      maxFreeSockets: MAX_FREE_SOCKETS_PER_ORIGIN,
      timeout: IDLE_POOL_SOCKET_TIMEOUT_MS,
      scheduling: "lifo",
    })
    // Intercept async socket creation so each pooled socket dials through the attachment's tunnel.
    const createConnection = (
      _options: unknown,
      callback?: (error: Error | null, socket?: Duplex) => void,
    ) => {
      const abort = new AbortController()
      if (!callback) throw new Error("Browser proxy pool requires async createConnection callback")
      void connect(destination, abort.signal).then(
        (socket) => {
          // Half-open sockets whose upstream server closes them while idle must leave the pool immediately.
          socket.once("end", () => {
            if (!socket.destroyed) socket.destroy()
          })
          callback(null, socket)
        },
        (error: unknown) => callback(asError(error)),
      )
      return undefined as unknown as Duplex
    }
    // SAFETY: Node's http.Agent invokes `createConnection(options, callback)` when a callback is accepted.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    agent.createConnection = createConnection as unknown as typeof agent.createConnection
    originPools.set(key, agent)
    return agent
  }

  const server = createServer({ maxHeaderSize: 64 * 1024 }, (incoming, response) => {
    void forward(incoming, response, agentForOrigin, authorized).catch((error: unknown) => {
      if (!response.headersSent) {
        const body = error instanceof Error ? error.message.slice(0, 256) : "Bad Gateway"
        response.writeHead(502, {
          connection: "close",
          "content-type": "text/plain; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
        })
        response.end(body)
        return
      }
      response.destroy()
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 30_000
  server.on("connection", (socket) => {
    // A backlog connection can surface while the server drains after `close()`.
    if (!BrowserProxyMachine.admits(state)) {
      socket.destroy()
      return
    }
    clients.add(socket)
    socket.setNoDelay(true)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => clients.delete(socket))
  })
  const upgrade = (incoming: IncomingMessage, socket: Duplex, head: Buffer, connectMethod: boolean) => {
    // Setup can throw before the close listeners pair the tunnel with the client socket.
    let opened: Duplex | undefined
    void (async () => {
      if (!authorized(incoming.headers["proxy-authorization"])) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="OpenCode Browser Proxy"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        )
        return
      }
      const url = parseURL(connectMethod ? `https://${incoming.url ?? ""}` : incoming.url)
      if (!url || (!connectMethod && incoming.headers.upgrade?.toLowerCase() !== "websocket")) {
        socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return
      }
      const abort = new AbortController()
      const cancel = () => abort.abort()
      socket.once("close", cancel)
      socket.pause()
      try {
        const tunnel = await connect(target(url), abort.signal)
        opened = tunnel
        if (socket.destroyed) {
          tunnel.destroy()
          return
        }
        if (connectMethod) socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (!connectMethod) {
          const headers = forwardedHeaders(incoming.headers)
          headers.host = url.host
          headers.connection = "Upgrade"
          headers.upgrade = "websocket"
          tunnel.write(
            `${incoming.method} ${url.pathname}${url.search} HTTP/1.1\r\n${Object.entries(headers)
              .flatMap(([key, value]) =>
                value === undefined
                  ? []
                  : (Array.isArray(value) ? value : [value]).map((item) => `${key}: ${item}\r\n`),
              )
              .join("")}\r\n`,
          )
        }
        if (head.byteLength) tunnel.write(head)
        socket.once("close", () => tunnel.destroy())
        tunnel.once("close", () => socket.destroy())
        socket.pipe(tunnel)
        tunnel.pipe(socket)
        socket.resume()
      } finally {
        socket.off("close", cancel)
      }
    })().catch(() => {
      opened?.destroy()
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    })
  }
  server.on("connect", (incoming, socket, head) => upgrade(incoming, socket, head, true))
  server.on("upgrade", (incoming, socket, head) => upgrade(incoming, socket, head, false))
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Browser proxy did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}`,
    host: "127.0.0.1",
    port: address.port,
    credentials: { username, password },
    resetPools: clearPools,
    close() {
      const next = BrowserProxyMachine.transition(state, { type: "close" })
      state = next.state
      next.effects.forEach(() => {
        offReset?.()
        clearPools()
        pending.forEach((abort) => abort.abort())
        tunnels.forEach((socket) => socket.destroy())
        clients.forEach((socket) => socket.destroy())
        server.close(() => closed.resolve())
      })
      return closed.promise
    },
  }
}

async function forward(
  incoming: IncomingMessage,
  response: ServerResponse,
  agentForOrigin: (target: Browser.TunnelTarget) => Agent,
  authorized: (value: string | undefined) => boolean,
) {
  if (!authorized(incoming.headers["proxy-authorization"])) {
    response.writeHead(407, {
      "Proxy-Authenticate": 'Basic realm="OpenCode Browser Proxy"',
      "Content-Length": "0",
      Connection: "close",
    })
    response.end()
    return
  }
  const url = parseURL(incoming.url)
  if (!url || url.protocol !== "http:") {
    response.writeHead(400, { "Content-Length": "0", Connection: "close" })
    response.end()
    return
  }
  const destination = target(url)
  const agent = agentForOrigin(destination)
  const abort = new AbortController()
  let finished = false
  const cancel = () => {
    if (!finished) abort.abort()
  }
  incoming.once("aborted", cancel)
  response.once("close", cancel)
  const headers = forwardedHeaders(incoming.headers)
  headers.host = url.host
  // Keep upstream HTTP/1.1 connections warm per origin/attachment; Node's Agent honours upstream `Connection: close`.
  headers.connection = "keep-alive"
  const clientWantsClose =
    incoming.httpVersion === "1.0" ||
    /\bclose\b/i.test(incoming.headers.connection ?? "") ||
    /\bclose\b/i.test(String(incoming.headers["proxy-connection"] ?? ""))

  try {
    await new Promise<void>((resolve, reject) => {
      const upstream = request(
        {
          agent,
          hostname: url.hostname,
          port: destination.port,
          path: `${url.pathname}${url.search}`,
          method: incoming.method,
          headers,
          signal: abort.signal,
        },
        (result) => {
          const status = result.statusCode ?? 502
          const bodyless = status === 204 || status === 304 || incoming.method === "HEAD"
          const explicitLength =
            result.headers["content-length"] !== undefined || result.headers["transfer-encoding"] !== undefined
          const responseHeaders = forwardedHeaders(result.headers)
          // Keep the local Chromium <-> proxy connection alive whenever framing is explicit and client allows it.
          if (clientWantsClose || (!bodyless && !explicitLength)) {
            responseHeaders.connection = "close"
          } else {
            responseHeaders.connection = "keep-alive"
          }
          response.writeHead(status, result.statusMessage, responseHeaders)
          result.once("error", (error) => {
            upstream.destroy()
            reject(error)
          })
          response.once("finish", () => {
            finished = true
            resolve()
          })
          result.pipe(response)
        },
      )
      upstream.once("error", reject)
      incoming.pipe(upstream)
    })
  } finally {
    incoming.off("aborted", cancel)
    response.off("close", cancel)
  }
}

function forwardedHeaders(input: IncomingHttpHeaders) {
  const headers = { ...input }
  headers.connection?.split(",").forEach((name) => delete headers[name.trim().toLowerCase()])
  ;[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].forEach((name) => delete headers[name])
  return headers
}

function parseURL(value: string | undefined) {
  if (!value || !URL.canParse(value)) return
  const url = new URL(value)
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) return
  return url
}

function target(url: URL) {
  return Schema.decodeUnknownSync(Browser.TunnelTarget)({
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port ? Number(url.port) : url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80,
  })
}

class TunnelSocket extends Duplex {
  readonly connecting = false
  private readonly abort = new AbortController()
  private reads: BrowserProxyMachine.ReadState = "idle"
  private idleTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly transport: Transport,
    private readonly id: string,
  ) {
    super({ highWaterMark: Browser.TUNNEL_CHUNK_BYTES, allowHalfOpen: true })
    this.on("error", () => this.destroy())
  }
  override _read() {
    if (!this.advance("pull")) return
    void this.transport.read(this.id, this.abort.signal).then(
      (result) => {
        if (!this.advance(result.eof ? "eof" : "chunk")) return
        if (result.eof) {
          this.push(null)
          return
        }
        if (this.push(result.data)) this._read()
      },
      (error: unknown) => this.destroy(asError(error)),
    )
  }
  private advance(event: BrowserProxyMachine.ReadEvent) {
    const next = BrowserProxyMachine.transitionRead(this.reads, event)
    if (next === this.reads) return false
    this.reads = next
    return true
  }
  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const data = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk
    void (async () => {
      for (let offset = 0; offset < data.byteLength; offset += Browser.TUNNEL_CHUNK_BYTES)
        await this.transport.write(
          this.id,
          data.subarray(offset, offset + Browser.TUNNEL_CHUNK_BYTES),
          false,
          this.abort.signal,
        )
    })().then(
      () => callback(),
      (error: unknown) => callback(asError(error)),
    )
  }
  override _final(callback: (error?: Error | null) => void) {
    void this.transport.write(this.id, new Uint8Array(), true, this.abort.signal).then(
      () => callback(),
      (error: unknown) => callback(asError(error)),
    )
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    this.advance("destroyed")
    this.abort.abort()
    void this.transport
      .close(this.id)
      .catch(() => undefined)
      .then(() => callback(error))
  }
  setKeepAlive() {
    return this
  }
  setNoDelay() {
    return this
  }
  setTimeout(timeout: number, callback?: () => void) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    if (timeout === 0) {
      if (callback) this.off("timeout", callback)
      return this
    }
    if (callback) this.once("timeout", callback)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      this.emit("timeout")
    }, timeout)
    this.idleTimer.unref?.()
    return this
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
