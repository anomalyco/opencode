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

type Environment = Readonly<Record<string, string | undefined>>

const environmentValue = (environment: Environment, name: string) =>
  environment[name] ?? environment[name.toLowerCase()]

const noProxy = (url: URL, value: string | undefined) => {
  if (!value) return false
  const port = url.port || (url.protocol === "wss:" ? "443" : "80")
  return value.split(/[\s,]+/).some((entry) => {
    if (!entry) return false
    if (entry === "*") return true
    const match = entry.match(/^(.+?):(\d+)$/)
    if (match?.[2] && match[2] !== port) return false
    const host = (match?.[1] ?? entry).toLowerCase().replace(/^\*/, "")
    const hostname = url.hostname.toLowerCase()
    return host.startsWith(".") ? hostname.endsWith(host) : hostname === host
  })
}

const proxy = (value: string, environment: Environment = process.env) => {
  const url = new URL(value)
  if (["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return undefined
  if (noProxy(url, environmentValue(environment, "NO_PROXY"))) return undefined
  const name = url.protocol === "wss:" ? "WSS_PROXY" : "WS_PROXY"
  const fallback = url.protocol === "wss:" ? "HTTPS_PROXY" : "HTTP_PROXY"
  return (
    environmentValue(environment, name) ??
    environmentValue(environment, fallback) ??
    environmentValue(environment, "ALL_PROXY")
  )
}

const options = (input: string | Array<string> | undefined): WebSocketOptions => {
  if (typeof input === "string" || Array.isArray(input)) return { protocols: input }
  // AI routes pass handshake options through Effect's browser-shaped constructor.
  return (input ?? {}) as WebSocketOptions
}

const layer = Layer.succeed(Socket.WebSocketConstructor, (url, input) => {
  const config = options(input)
  const selectedProxy = proxy(url)
  if (typeof Bun !== "undefined") {
    return new globalThis.WebSocket(url, {
      headers: config.headers,
      protocols: config.protocols,
      ...(selectedProxy ? { proxy: selectedProxy } : {}),
    })
  }

  const agent = selectedProxy
    ? url.startsWith("wss:") || selectedProxy.startsWith("https:")
      ? new HttpsProxyAgent(selectedProxy)
      : new HttpProxyAgent(selectedProxy)
    : undefined
  const native = {
    headers: config.headers,
    agent,
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
