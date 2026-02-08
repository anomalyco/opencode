/**
 * Sandbox Agent Proxy Middleware
 * Strictly forwards requests to the local Sandbox Agent.
 * Used when Config.USE_RIVET_SANDBOX_AGENT_SERVER is true.
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { directoryProxyRoots, shouldDirectoryProxy } from "../routes/index.ts"
import { handleCorsPreflight, proxyRequest } from "./forward.ts"
import { getSandboxAgentToken, getSandboxAgentUrl } from "../routes/sandbox-agent.ts"
import { withDevCors } from "./headers.ts"
import type { GatewayContext } from "../context.ts"

export const SandboxAgentProxyMiddleware = lazy(() =>
  new Hono<GatewayContext>().use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname

    // 1. Filter: Skip internal/gateway routes (Explicit Skips)
    if (pathname.startsWith("/api/")) return next()
    if (pathname.startsWith("/w/")) return next()
    if (pathname.startsWith("/s/")) return next()
    if (pathname.startsWith("/hook")) return next()
    if (pathname === "/global/health") return next()

    // 2. Filter: Only proxy allowed API roots
    if (!shouldDirectoryProxy(pathname)) return next()

    // 3. Handle OPTIONS
    if (c.req.method === "OPTIONS") {
      return handleCorsPreflight(c)
    }

    // 4. Resolve Agent Target
    const agentUrl = getSandboxAgentUrl()
    if (!agentUrl) {
      // If configured to use Agent but it's not running, we FAIL SAFE rather than falling back.
      // User can use /api/sandbox-agent to start it.
      return next() // or 502? User requested Agent mode, so maybe 502 is better?
      // "Explicit Switch" implies strictness. But if agent isn't ready,
      // the UI might poll. Falling through to 404 is standard behavior for "service down".
      // But let's stick to fail-fast if we want to be explicit.
      // However, for startup race conditions, next() is safer (let UI handle 404/health check).
    }

    const token = getSandboxAgentToken()

    try {
      const extraHeaders: Record<string, string> = {}
      if (token) extraHeaders["authorization"] = `Bearer ${token}`

      return await proxyRequest(c, {
        upstreamBase: agentUrl,
        pathPrefix: "/opencode", // Agent namespace
        extraHeaders,
        cors: true,
        responseTag: "x-sandbox-agent",
      })
    } catch (err: any) {
      const headers = withDevCors(c.req.raw, new Headers({ "content-type": "application/json" }))
      return new Response(JSON.stringify({ error: "Agent proxy failed", detail: err.message }), { status: 502, headers })
    }
  })
)
