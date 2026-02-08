/**
 * Local OpenCode Proxy Middleware
 * Strictly forwards requests to the local OpenCode server (localhost).
 * Used when Config.SANDBOX_ENABLED is false AND Config.USE_RIVET_SANDBOX_AGENT_SERVER is false.
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { Config } from "../../config/index.ts"
import { directoryProxyRoots, localOnlyProxyRoots, shouldDirectoryProxy } from "../routes/index.ts"
import { handleCorsPreflight, proxyRequest } from "./forward.ts"
import { withDevCors } from "./headers.ts"
import type { GatewayContext } from "../context.ts"

export const LocalProxyMiddleware = lazy(() =>
  new Hono<GatewayContext>().use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname

    // 1. Filter: Skip internal/gateway routes
    if (pathname.startsWith("/api/")) return next()
    if (pathname.startsWith("/w/")) return next()
    if (pathname.startsWith("/s/")) return next()
    if (pathname.startsWith("/hook")) return next()

    // 2. Filter: Only proxy allowed API roots
    const root = pathname.split("/").filter(Boolean)[0] || ""
    const isProxyRoot = shouldDirectoryProxy(pathname) || localOnlyProxyRoots.has(root)
    
    if (!isProxyRoot) return next()

    // 3. Handle OPTIONS
    if (c.req.method === "OPTIONS") {
      return handleCorsPreflight(c)
    }

    // 4. Resolve Local Target
    const targetUrl = Config.OPENCODE_URL

    try {
      return await proxyRequest(c, {
        upstreamBase: targetUrl,
        pathPrefix: "", // No prefix
        cors: true,
        responseTag: "x-opencode-local",
      })
    } catch (err: any) {
      const headers = withDevCors(c.req.raw, new Headers({ "content-type": "application/json" }))
      return new Response(JSON.stringify({ error: "Local proxy failed", detail: err.message }), { status: 502, headers })
    }
  })
)
