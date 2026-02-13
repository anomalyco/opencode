/**
 * Shared proxy utilities for forwarding requests to OpenCode servers
 */
import { Context } from "hono"
import { stripHopByHopHeaders, withDevCors } from "./headers.ts"
import { fetchFollow } from "./fetch.ts"

export interface ProxyOptions {
  upstreamBase: string
  pathPrefix?: string // e.g. "/opencode" for sandbox-agent
  extraHeaders?: Record<string, string>
  cors?: boolean
  responseTag?: string // header value for tracking (e.g. "x-sandbox-agent")
  signal?: AbortSignal
}

/**
 * Handle OPTIONS preflight requests for proxy routes
 */
export function handleCorsPreflight(c: Context) {
  const headers = withDevCors(
    c.req.raw,
    new Headers({
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        c.req.header("access-control-request-headers") ?? "content-type,authorization,x-opencode-directory",
      "access-control-max-age": "600",
    }),
  )
  return new Response(null, { status: 204, headers })
}

/**
 * Proxy a request to an upstream OpenCode server
 */
export async function proxyRequest(c: Context, opts: ProxyOptions): Promise<Response> {
  const incomingUrl = new URL(c.req.url)
  const prefix = opts.pathPrefix ?? ""
  
  // Construct upstream URL
  const upstreamBase = opts.upstreamBase.replace(/\/+$/, "")
  const upstreamUrl = `${upstreamBase}${prefix}${incomingUrl.pathname}${incomingUrl.search}`

  // Prepare headers
  const headers = stripHopByHopHeaders(c.req.raw.headers)
  headers.set("host", new URL(upstreamBase).host)
  if (headers.has("origin")) headers.set("origin", upstreamBase)
  headers.delete("referer")
  headers.set("user-agent", "claxedo-gateway/1.0")

  if (opts.extraHeaders) {
    for (const [key, value] of Object.entries(opts.extraHeaders)) {
      headers.set(key, value)
    }
  }

  // Handle body
  let body: BodyInit | undefined
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    // Read as ArrayBuffer to handle binary data correctly
    const buffer = await c.req.raw.arrayBuffer().catch(() => undefined)
    if (buffer) body = buffer
  }

  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: c.req.method,
      headers,
      body,
      signal: opts.signal ?? c.req.raw.signal,
      duplex: "half",
    }

    const upstreamRes = await fetchFollow(upstreamUrl, init)

    // Prepare response headers
    const resHeaders = new Headers(upstreamRes.headers)
    resHeaders.delete("set-cookie")
    
    if (opts.responseTag) {
      resHeaders.set(opts.responseTag, "forwarded")
    }

    if (opts.cors) {
      withDevCors(c.req.raw, resHeaders)
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    })
  } catch (err: any) {
    // If we fail to connect to upstream, throw so caller can decide (fallback or error)
    throw err
  }
}
