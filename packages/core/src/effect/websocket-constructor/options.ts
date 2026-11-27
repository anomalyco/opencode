import type { Socket } from "effect/socket"

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

export const proxy = (value: string, environment: Environment = process.env) => {
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

export const constructorOptions = (
  input: Socket.WebSocketConstructorOptions | undefined,
): Socket.WebSocketClientOptions =>
  typeof input === "string" || Array.isArray(input)
    ? { protocols: input }
    : { headers: input?.headers, protocols: input?.protocols }
