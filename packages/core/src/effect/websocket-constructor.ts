import { NodeSocket } from "@effect/platform-node"
import { HttpProxyAgent } from "http-proxy-agent"
import { HttpsProxyAgent } from "https-proxy-agent"
import { Layer } from "effect"
import { Headers } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"

interface WebSocketOptions {
  readonly headers?: Headers.Headers
  readonly protocols?: string | Array<string>
}

type BunWebSocketConstructor = new (
  url: string,
  options: WebSocketOptions & { readonly proxy?: string },
) => globalThis.WebSocket

type Environment = Readonly<Record<string, string | undefined>>

const environmentValue = (environment: Environment, name: string) =>
  environment[name] ?? environment[name.toLowerCase()]

const bypassesProxy = (url: URL, value: string | undefined) => {
  if (!value) return false
  const port = url.port || (url.protocol === "wss:" ? "443" : "80")
  const hostname = url.hostname.toLowerCase()
  return value.split(/[\s,]+/).some((entry) => {
    if (!entry) return false
    if (entry === "*") return true
    const match = entry.match(/^(.+?):(\d+)$/)
    if (match?.[2] && match[2] !== port) return false
    const host = (match?.[1] ?? entry).toLowerCase().replace(/^\*/, "")
    return host.startsWith(".") ? hostname.endsWith(host) : hostname === host
  })
}

const proxy = (value: string, environment: Environment = process.env) => {
  const url = new URL(value)
  if (["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return undefined
  if (bypassesProxy(url, environmentValue(environment, "NO_PROXY"))) return undefined
  const protocolProxy = url.protocol === "wss:" ? "WSS_PROXY" : "WS_PROXY"
  const standardProxy = url.protocol === "wss:" ? "HTTPS_PROXY" : "HTTP_PROXY"
  return (
    environmentValue(environment, protocolProxy) ??
    environmentValue(environment, standardProxy) ??
    environmentValue(environment, "ALL_PROXY")
  )
}

const constructorOptions = (input: string | Array<string> | undefined): WebSocketOptions => {
  if (typeof input === "string" || Array.isArray(input)) return { protocols: input }
  // AI routes pass handshake options through Effect's browser-shaped constructor.
  return (input ?? {}) as WebSocketOptions
}

const proxyAgent = (url: string, selectedProxy: string | undefined) => {
  if (!selectedProxy) return undefined
  if (url.startsWith("wss:") || selectedProxy.startsWith("https:")) return new HttpsProxyAgent(selectedProxy)
  return new HttpProxyAgent(selectedProxy)
}

const layer = Layer.succeed(Socket.WebSocketConstructor, (url, input) => {
  const config = constructorOptions(input)
  const selectedProxy = proxy(url)
  // Keep trust on the runtime store so NODE_EXTRA_CA_CERTS remains additive.
  if (typeof Bun !== "undefined") {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Bun extends the browser constructor with handshake and network options.
    const WebSocket = globalThis.WebSocket as unknown as BunWebSocketConstructor
    return new WebSocket(url, {
      headers: config.headers,
      protocols: config.protocols,
      ...(selectedProxy ? { proxy: selectedProxy } : {}),
    })
  }

  const native = {
    headers: config.headers,
    agent: proxyAgent(url, selectedProxy),
    // Reject redirects before headers can cross an origin boundary; the caller safely falls back to HTTP.
    followRedirects: false,
  }
  const socket = config.protocols
    ? new NodeSocket.NodeWS.WebSocket(url, config.protocols, native)
    : new NodeSocket.NodeWS.WebSocket(url, native)
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- ws implements the WebSocket surface consumed by the AI transport.
  return socket as unknown as globalThis.WebSocket
})

export const WebSocketConstructor = { layer, proxy } as const
