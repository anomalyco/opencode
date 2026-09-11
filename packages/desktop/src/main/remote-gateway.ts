import * as http from "node:http"
import * as https from "node:https"
import { networkInterfaces } from "node:os"

export type RemoteGatewayInfo = {
  port: number
  urls: string[]
}

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

type RemoteGatewayOptions = {
  upstreamUrl: string
  logger?: Logger
  networkInterfaces?: typeof networkInterfaces
}

const blockedRequestHeaders = new Set([
  "connection",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
])

const blockedResponseHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-connection",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export function createRemoteGateway(options: RemoteGatewayOptions) {
  const upstream = new URL(options.upstreamUrl)
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error(`Unsupported remote gateway upstream protocol: ${upstream.protocol}`)
  }

  const getNetworkInterfaces = options.networkInterfaces ?? networkInterfaces
  let server: http.Server | undefined
  let info: RemoteGatewayInfo | undefined

  const currentInfo = () => {
    if (!server || !info) return
    info = {
      port: info.port,
      urls: lanUrls(info.port, getNetworkInterfaces()),
    }
    return info
  }

  const start = async (): Promise<RemoteGatewayInfo> => {
    const current = currentInfo()
    if (current) return current

    const next = http.createServer((request, response) => {
      if (!isAllowedNetworkRequest(request)) {
        response.writeHead(403).end()
        return
      }
      const incoming = requestURL(request.url)
      if (!incoming) {
        response.writeHead(400).end()
        return
      }
      if (!isRemotePath(incoming.pathname)) {
        response.writeHead(404).end()
        return
      }

      proxyRequest(upstream, incoming, request, response, options.logger)
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        next.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        next.off("error", onError)
        resolve()
      }
      next.once("error", onError)
      next.once("listening", onListening)
      next.listen(0, "0.0.0.0")
    })

    const address = next.address()
    if (!address || typeof address === "string") {
      await closeServer(next)
      throw new Error("Remote gateway did not expose a TCP address")
    }

    server = next
    info = {
      port: address.port,
      urls: lanUrls(address.port, getNetworkInterfaces()),
    }
    options.logger?.log("remote gateway started", { port: info.port, urls: info.urls })
    return info
  }

  const stop = async () => {
    const current = server
    server = undefined
    info = undefined
    if (!current) return
    await closeServer(current)
    options.logger?.log("remote gateway stopped")
  }

  return {
    start,
    stop,
    status: currentInfo,
  }
}

function requestURL(rawUrl: string | undefined) {
  try {
    return new URL(rawUrl ?? "/", "http://remote.invalid")
  } catch {
    return
  }
}

function isRemotePath(pathname: string) {
  return pathname === "/remote" || pathname.startsWith("/remote/")
}

function normalizeIPv4(address: string | undefined) {
  if (!address) return
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length)
  return address
}

function isAllowedNetworkAddress(address: string | undefined) {
  const value = normalizeIPv4(address)
  if (!value) return false
  if (value === "::1" || value.startsWith("127.")) return true
  return isPrivateIPv4(value)
}

function isAllowedNetworkRequest(request: http.IncomingMessage) {
  return isAllowedNetworkAddress(request.socket.localAddress) && isAllowedNetworkAddress(request.socket.remoteAddress)
}

function hopByHop(headers: http.IncomingHttpHeaders, fixed: Set<string>) {
  const blocked = new Set(fixed)
  for (const token of headers.connection?.split(",") ?? []) {
    const name = token.trim().toLowerCase()
    if (name) blocked.add(name)
  }
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())))
}

function proxyRequest(
  upstream: URL,
  incoming: URL,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  logger?: Logger,
) {
  const target = new URL(upstream)
  target.pathname = incoming.pathname
  target.search = incoming.search
  target.hash = ""
  const requestImpl = target.protocol === "https:" ? https.request : http.request
  const headers = hopByHop(request.headers, blockedRequestHeaders)

  if (request.headers.host) headers["x-forwarded-host"] = request.headers.host
  headers["x-forwarded-proto"] = "http"

  const proxy = requestImpl(
    target,
    {
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = hopByHop(upstreamResponse.headers, blockedResponseHeaders)
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
      upstreamResponse.pipe(response)
    },
  )

  proxy.on("error", (error) => {
    logger?.warn("remote gateway proxy failed", { error: error.message })
    if (!response.headersSent) response.writeHead(502)
    response.end()
  })

  request.on("aborted", () => proxy.destroy())
  response.on("close", () => {
    if (!response.writableEnded) proxy.destroy()
  })
  request.pipe(proxy)
}

function lanUrls(port: number, interfaces: ReturnType<typeof networkInterfaces>) {
  const addresses = new Set<string>()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4" || !isPrivateIPv4(entry.address)) continue
      addresses.add(entry.address)
    }
  }
  return [...addresses].sort(privateAddressRank).map((address) => `http://${address}:${port}`)
}

function privateAddressRank(a: string, b: string) {
  return privateRangeRank(a) - privateRangeRank(b) || a.localeCompare(b)
}

function privateRangeRank(address: string) {
  if (address.startsWith("192.168.")) return 0
  if (address.startsWith("10.")) return 1
  return 2
}

function isPrivateIPv4(address: string) {
  if (address.startsWith("10.")) return true
  if (address.startsWith("192.168.")) return true
  const match = /^172\.(\d+)\./.exec(address)
  if (!match) return false
  const second = Number(match[1])
  return second >= 16 && second <= 31
}

function closeServer(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeIdleConnections()
    server.closeAllConnections()
  })
}
