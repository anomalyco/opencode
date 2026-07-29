import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
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

export type BrowserProxyConnector = (target: BrowserTunnel.Target, signal: AbortSignal) => Promise<Duplex>

/** Starts a loopback-only authenticated HTTP proxy backed exclusively by tunnel connections. */
export async function createBrowserProxy(input: { readonly connect: BrowserProxyConnector }) {
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
  const connect = async (target: BrowserTunnel.Target, signal?: AbortSignal) => {
    if (closed) throw new Error("Browser proxy is closed")
    const abort = new AbortController()
    const cancel = () => abort.abort(signal?.reason)
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
    pending.add(abort)
    try {
      const tunnel = await input.connect(target, abort.signal)
      if (closed || abort.signal.aborted) {
        tunnel.destroy()
        throw abort.signal.reason ?? new Error("Browser proxy is closed")
      }
      tunnels.add(tunnel)
      tunnel.once("close", () => tunnels.delete(tunnel))
      tunnel.on("error", () => tunnel.destroy())
      return tunnel
    } finally {
      pending.delete(abort)
      signal?.removeEventListener("abort", cancel)
    }
  }

  const server = createServer({ maxHeaderSize: 64 * 1_024 }, (incoming, response) => {
    void forward(incoming, response, connect, authorized).catch(() => response.destroy())
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.on("connection", (socket) => {
    clients.add(socket)
    socket.once("close", () => clients.delete(socket))
  })
  server.on("connect", (incoming, socket, head) => {
    void (async () => {
      if (!authorized(singleHeader(incoming.headers["proxy-authorization"]))) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="OpenCode Browser Proxy"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        )
        return
      }
      const destination = authority(incoming.url ?? "", 443)
      if (!destination) {
        socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        return
      }
      const abort = new AbortController()
      const cancel = () => abort.abort(new Error("Browser proxy client closed"))
      socket.once("close", cancel)
      socket.pause()
      const tunnel = await connect(destination, abort.signal)
      socket.off("close", cancel)
      if (socket.destroyed) {
        tunnel.destroy()
        return
      }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.byteLength) tunnel.write(head)
      bridge(socket, tunnel)
      socket.resume()
    })().catch(() => {
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    })
  })
  server.on("error", () => undefined)
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
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
      tunnels.forEach((tunnel) => tunnel.destroy())
      clients.forEach((client) => client.destroy())
      closing = new Promise<void>((resolve) => server.close(() => resolve()))
      return closing
    },
  }
}

async function forward(
  incoming: IncomingMessage,
  response: ServerResponse,
  connect: (target: BrowserTunnel.Target, signal?: AbortSignal) => Promise<Duplex>,
  authorized: (header: string | undefined) => boolean,
) {
  if (!authorized(singleHeader(incoming.headers["proxy-authorization"]))) {
    response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="OpenCode Browser Proxy"' })
    response.end()
    return
  }
  const url = parseURL(incoming.url)
  if (!url || url.protocol !== "http:" || !url.hostname || url.username || url.password) {
    response.writeHead(400)
    response.end()
    return
  }
  const port = url.port ? Number(url.port) : 80
  const abort = new AbortController()
  let tunnel: Duplex | undefined
  let agent: Agent | undefined
  const cancel = () => {
    abort.abort(new Error("Browser proxy client closed"))
    tunnel?.destroy()
  }
  incoming.once("aborted", cancel)
  response.once("close", cancel)
  try {
    tunnel = await connect(target(normalizeHostname(url.hostname), port), abort.signal)
    const headers = forwardedHeaders(incoming.headers)
    headers.host = url.host
    headers.connection = "close"
    agent = new Agent({ keepAlive: false, maxSockets: 1 })
    const connection = tunnel
    agent.createConnection = () => connection
    await new Promise<void>((resolve, reject) => {
      const upstream = request(
        {
          agent,
          hostname: url.hostname,
          port,
          path: `${url.pathname}${url.search}`,
          method: incoming.method,
          headers,
          signal: abort.signal,
        },
        (result) => {
          const headers = forwardedHeaders(result.headers)
          headers.connection = "close"
          response.writeHead(result.statusCode ?? 502, result.statusMessage, headers)
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
    agent?.destroy()
    tunnel?.destroy()
  }
}

function forwardedHeaders(input: IncomingHttpHeaders) {
  const headers = { ...input }
  singleHeader(headers.connection)
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .forEach((name) => delete headers[name])
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

function bridge(client: Duplex, tunnel: Duplex) {
  client.on("error", () => tunnel.destroy())
  tunnel.on("error", () => client.destroy())
  client.once("close", () => tunnel.destroy())
  tunnel.once("close", () => client.destroy())
  client.pipe(tunnel)
  tunnel.pipe(client)
}

function authority(value: string, defaultPort: number) {
  const bracket = /^\[([^\]]+)](?::([0-9]+))?$/.exec(value)
  if (bracket) return validAuthority(bracket[1], bracket[2], defaultPort)
  const separator = value.lastIndexOf(":")
  if (separator < 0) return validAuthority(value, undefined, defaultPort)
  if (value.slice(0, separator).includes(":")) return undefined
  return validAuthority(value.slice(0, separator), value.slice(separator + 1), defaultPort)
}

function validAuthority(host: string, value: string | undefined, defaultPort: number) {
  if (!host || (value !== undefined && !/^[0-9]+$/.test(value))) return undefined
  const port = value === undefined ? defaultPort : Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return undefined
  try {
    return target(host, port)
  } catch {
    return undefined
  }
}

function target(host: string, port: number): BrowserTunnel.Target {
  return { host: BrowserTunnel.Host.make(host), port: BrowserTunnel.Port.make(port) }
}

function parseURL(value: string | undefined) {
  try {
    return new URL(value ?? "")
  } catch {
    return undefined
  }
}

function normalizeHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
}

function singleHeader(value: string | ReadonlyArray<string> | undefined) {
  return typeof value === "string" ? value : undefined
}
