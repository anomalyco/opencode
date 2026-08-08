import * as http from "node:http"
import * as https from "node:https"
import type { AddressInfo } from "node:net"
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
}

const blockedRequestHeaders = new Set([
  "connection",
  "host",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

const blockedResponseHeaders = new Set(["connection", "proxy-authenticate", "trailer", "transfer-encoding", "upgrade"])

export function createRemoteGateway(options: RemoteGatewayOptions) {
  const upstream = new URL(options.upstreamUrl)
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error(`Unsupported remote gateway upstream protocol: ${upstream.protocol}`)
  }

  let server: http.Server | undefined
  let info: RemoteGatewayInfo | undefined

  const start = async (): Promise<RemoteGatewayInfo> => {
    if (server && info) return info

    const next = http.createServer((request, response) => {
      if (!isRemotePath(request.url)) {
        response.writeHead(404).end()
        return
      }

      proxyRequest(upstream, request, response, options.logger)
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
      urls: lanUrls(address.port),
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
    status: () => info,
  }
}

function isRemotePath(rawUrl: string | undefined) {
  const pathname = new URL(rawUrl ?? "/", "http://localhost").pathname
  return pathname === "/remote" || pathname.startsWith("/remote/")
}

function proxyRequest(
  upstream: URL,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  logger?: Logger,
) {
  const target = new URL(request.url ?? "/", upstream)
  const requestImpl = target.protocol === "https:" ? https.request : http.request
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !blockedRequestHeaders.has(name.toLowerCase())),
  )

  headers["x-forwarded-host"] = request.headers.host
  headers["x-forwarded-proto"] = "http"

  const proxy = requestImpl(
    target,
    {
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = Object.fromEntries(
        Object.entries(upstreamResponse.headers).filter(([name]) => !blockedResponseHeaders.has(name.toLowerCase())),
      )
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

function lanUrls(port: number) {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue
      addresses.add(entry.address)
    }
  }
  return [...addresses].sort(privateAddressRank).map((address) => `http://${address}:${port}`)
}

function privateAddressRank(a: string, b: string) {
  return Number(!isPrivateIPv4(a)) - Number(!isPrivateIPv4(b)) || a.localeCompare(b)
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
