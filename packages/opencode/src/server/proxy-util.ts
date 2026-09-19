const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

function sanitize(out: Headers, stripCredentials: boolean) {
  for (const key of hop) out.delete(key)
  out.delete("accept-encoding")
  out.delete("x-opencode-directory")
  out.delete("x-opencode-workspace")
  // A remote workspace target is a different trust domain: forwarding the caller's
  // bearer/cookie to it leaks host credentials. Explicit per-target headers passed
  // as `extra` are applied afterwards and still carry the workspace's own auth.
  if (stripCredentials) {
    out.delete("authorization")
    out.delete("cookie")
  }
}

export function headers(
  input: Request | HeadersInit | Record<string, string>,
  extra?: HeadersInit,
  options?: { stripCredentials?: boolean },
) {
  const raw = input instanceof Request ? input.headers : input
  const out = new Headers(raw instanceof Headers ? raw : Object.entries(raw as Record<string, string>))
  sanitize(out, options?.stripCredentials ?? false)
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

export function websocketProtocols(input: Request | Record<string, string | undefined>) {
  const value = input instanceof Request ? input.headers.get("sec-websocket-protocol") : input["sec-websocket-protocol"]
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function websocketTargetURL(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}

export * as ProxyUtil from "./proxy-util"
