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
import { Browser } from "./rpc.js"

export type Transport = {
  open(target: Browser.TunnelTarget, signal: AbortSignal): Promise<string>
  read(id: string, signal: AbortSignal): Promise<Browser.TunnelRead>
  write(id: string, data: Uint8Array, end: boolean, signal: AbortSignal): Promise<void>
  close(id: string): Promise<void>
}
export type Proxy = Awaited<ReturnType<typeof make>>

// Desktop-only leaf. This listener is never loaded by the server plugin.
export async function make(transport: Transport) {
  const username = randomBytes(16).toString("hex")
  const password = randomBytes(32).toString("hex")
  const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`)
  const clients = new Set<Duplex>()
  const tunnels = new Set<Duplex>()
  const pending = new Set<AbortController>()
  let closed = false
  const authorized = (value: string | undefined) => {
    if (!value) return false
    const actual = Buffer.from(value)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  const connect = async (target: Browser.TunnelTarget, signal: AbortSignal) => {
    if (closed) throw new Error("Browser proxy is closed")
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    pending.add(abort)
    try {
      const id = await transport.open(target, abort.signal)
      const socket = new TunnelSocket(transport, id)
      if (closed || abort.signal.aborted) {
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
  const server = createServer({ maxHeaderSize: 64 * 1024 }, (incoming, response) => {
    void forward(incoming, response, connect, authorized).catch(() => {
      if (!response.headersSent) {
        response.writeHead(502)
        response.end()
        return
      }
      response.destroy()
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.on("connection", (socket) => {
    clients.add(socket)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => clients.delete(socket))
  })
  const upgrade = (incoming: IncomingMessage, socket: Duplex, head: Buffer, connectMethod: boolean) => {
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
  let closing: Promise<void> | undefined
  return {
    url: `http://127.0.0.1:${address.port}`,
    host: "127.0.0.1",
    port: address.port,
    credentials: { username, password },
    close() {
      if (closing) return closing
      closed = true
      pending.forEach((abort) => abort.abort())
      tunnels.forEach((socket) => socket.destroy())
      clients.forEach((socket) => socket.destroy())
      closing = new Promise<void>((resolve) => server.close(() => resolve()))
      return closing
    },
  }
}

async function forward(
  incoming: IncomingMessage,
  response: ServerResponse,
  connect: (target: Browser.TunnelTarget, signal: AbortSignal) => Promise<Duplex>,
  authorized: (value: string | undefined) => boolean,
) {
  if (!authorized(incoming.headers["proxy-authorization"])) {
    response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="OpenCode Browser Proxy"' })
    response.end()
    return
  }
  const url = parseURL(incoming.url)
  if (!url || url.protocol !== "http:") {
    response.writeHead(400)
    response.end()
    return
  }
  const abort = new AbortController()
  const cancel = () => abort.abort()
  incoming.once("aborted", cancel)
  response.once("close", cancel)
  const agent = new Agent({ keepAlive: false, maxSockets: 1 })
  try {
    const tunnel = await connect(target(url), abort.signal)
    agent.createConnection = () => tunnel
    const headers = forwardedHeaders(incoming.headers)
    headers.host = url.host
    headers.connection = "close"
    await new Promise<void>((resolve, reject) => {
      const upstream = request(
        {
          agent,
          hostname: url.hostname,
          port: url.port || 80,
          path: `${url.pathname}${url.search}`,
          method: incoming.method,
          headers,
          signal: abort.signal,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.statusMessage, {
            ...forwardedHeaders(result.headers),
            connection: "close",
          })
          result.once("error", reject)
          response.once("finish", resolve)
          result.pipe(response)
        },
      )
      upstream.once("error", reject)
      incoming.pipe(upstream)
    })
  } finally {
    incoming.off("aborted", cancel)
    response.off("close", cancel)
    agent.destroy()
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
  private pending = false

  constructor(
    private readonly transport: Transport,
    private readonly id: string,
  ) {
    super({ highWaterMark: Browser.TUNNEL_CHUNK_BYTES, allowHalfOpen: true })
    this.on("error", () => this.destroy())
  }
  override _read() {
    if (this.pending || this.destroyed) return
    this.pending = true
    void this.transport.read(this.id, this.abort.signal).then(
      (result) => {
        this.pending = false
        if (this.destroyed) return
        if (result.eof) {
          this.push(null)
          return
        }
        if (this.push(result.data)) this._read()
      },
      (error: unknown) => this.destroy(asError(error)),
    )
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
  setTimeout(_timeout: number, callback?: () => void) {
    if (callback) this.once("timeout", callback)
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
