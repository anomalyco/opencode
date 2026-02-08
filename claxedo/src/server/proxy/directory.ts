/**
 * Directory-based proxy middleware
 * UI talks to the gateway root and includes `x-opencode-directory` (or `?directory=`).
 * The gateway resolves `directory -> workspace -> sandbox` and proxies OpenCode API calls.
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { logJson, nowMs } from "../lib/logging.ts"
import { directoryFrom } from "../lib/paths.ts"
import { stripHopByHopHeaders, withDevCors } from "./headers.ts"
import { fetchFollow } from "./fetch.ts"
import { shouldDirectoryProxy } from "../routes/index.ts"
import { resolveDirectoryUpstream, resolveOrganizationIdForWorkspace } from "../../services/sandbox-resolver.ts"

import { touchDirectory } from "../events/upstream.ts"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import { resolveIdentity } from "../../services/identity.ts"
import { Config } from "../../config/index.ts"
import type { GatewayContext } from "../context.ts"
import {
  withSpan,
  SpanKind,
  injectTraceContext,
  proxyRequestDuration,
  proxyResolutionDuration,
  setSpanAttributes,
} from "../../observability/index.ts"

export const DirectoryProxyMiddleware = lazy(() =>
  new Hono<GatewayContext>().use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname

    // Skip paths handled by other routes
    if (pathname.startsWith("/api/")) return next()
    if (pathname.startsWith("/w/")) return next()
    if (pathname.startsWith("/s/")) return next()
    if (pathname.startsWith("/s/")) return next()
    if (!shouldDirectoryProxy(pathname)) return next()

    // Optimization: Handle Session List from Convex cache (skip proxy)
    // Only when Convex is configured; in local dev, proxy to OpenCode server
    if (pathname === "/session" && c.req.method === "GET" && Config.CONVEX_URL) return next()

    const directory = directoryFrom(c)
    if (!directory) return next()

    const reqId = c.get("reqId")

    // Handle CORS preflight
    if (c.req.method === "OPTIONS") {
      logJson("info", {
        reqId,
        kind: "proxy.preflight",
        directory,
        origin: c.req.header("origin") ?? undefined,
        acrm: c.req.header("access-control-request-method") ?? undefined,
        acrh: c.req.header("access-control-request-headers") ?? undefined,
      })
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

    ;(globalThis as any).__claxedo_reqId = reqId
    try {
      const t0 = nowMs()

      // Resolve directory to upstream with tracing
      const resolved = await withSpan(
        "gateway.proxy.directory.resolve",
        async (span) => {
          const result = await resolveDirectoryUpstream(directory)
          if (result) {
            span.setAttribute("workspace.id", result.workspaceId)
            span.setAttribute("sandbox.id", result.sandboxId ?? "unknown")
          }
          return result
        },
        { kind: SpanKind.CLIENT },
      )
      const resolveMs = nowMs() - t0

      // Record resolution metrics
      proxyResolutionDuration.observe(
        { proxy_type: "directory", cache_hit: resolveMs < 10 ? "true" : "false" },
        resolveMs / 1000,
      )

      if (!resolved) {
        // No cloud sandbox found — try local OpenCode server as fallback
        return next()
      }

      // ═══════════════════════════════════════════════════════════════
      // AUTHENTICATION - Check workspace ownership for directory
      // Skip when AUTH_ENABLED=false (local dev mode)
      // ═══════════════════════════════════════════════════════════════
      if (Config.AUTH_ENABLED) {
        const identity = await resolveIdentity(c)
        if (!identity.ok) {
          return c.json({ error: identity.error }, identity.status)
        }

        // Check workspace ownership - FAIL CLOSED
        let workspaceOrgId: string | null
        try {
          workspaceOrgId = await resolveOrganizationIdForWorkspace(resolved.workspaceId)
        } catch (err) {
          return c.json({ error: "Failed to verify directory ownership" }, 500)
        }

        // FAIL CLOSED: If we can't determine ownership, deny access
        if (!workspaceOrgId) {
          return c.json({ error: "Cannot verify directory ownership" }, 403)
        }
        if (workspaceOrgId !== identity.organizationId) {
          return c.json({ error: "Forbidden: directory belongs to different organization" }, 403)
        }
      }

      // Ensure upstream event stream is running
      touchDirectory(resolved.directory)

      const upstreamBase = resolved.sandboxUrl.replace(/\/+$/, "")
      const incomingUrl = new URL(c.req.url)
      const upstreamUrl = new URL(`${upstreamBase}${incomingUrl.pathname}${incomingUrl.search}`)
      upstreamUrl.searchParams.delete("directory")

      logJson("info", {
        reqId,
        kind: "proxy.request",
        workspaceId: resolved.workspaceId,
        sandboxId: resolved.sandboxId,
        method: c.req.method,
        path: incomingUrl.pathname,
        upstreamHost: new URL(upstreamBase).host,
      })

      const headers = stripHopByHopHeaders(c.req.raw.headers)
      headers.set("host", new URL(upstreamBase).host)
      headers.set("x-opencode-directory", resolved.directory)
      if (headers.has("origin")) headers.set("origin", upstreamBase)
      headers.delete("referer")
      headers.set("user-agent", "claxedo-gateway/1.0")

      const teeBody = c.req.method !== "GET" && c.req.method !== "HEAD"
      const bodyBytes = teeBody ? await c.req.raw.arrayBuffer().catch(() => undefined) : undefined
      const bodyBuffer = bodyBytes ? Buffer.from(bodyBytes) : undefined

      // Inject trace context into headers for upstream
      const headersObj: Record<string, string> = {}
      headers.forEach((value, key) => {
        headersObj[key] = value
      })
      const tracedHeaders = injectTraceContext(headersObj)
      const finalHeaders = new Headers(tracedHeaders)

      const init: RequestInit & { duplex?: "half" } = {
        method: c.req.method,
        headers: finalHeaders,
        body: teeBody ? bodyBuffer : undefined,
        duplex: "half",
      }

      const tFetchStart = nowMs()
      const upstreamRes = await withSpan(
        "gateway.proxy.directory.fetch",
        async (span) => {
          span.setAttribute("http.url", upstreamUrl.toString())
          span.setAttribute("http.method", c.req.method)
          const res = await fetchFollow(upstreamUrl.toString(), init)
          span.setAttribute("http.status_code", res.status)
          return res
        },
        { kind: SpanKind.CLIENT },
      )
      const upstreamMs = nowMs() - tFetchStart

      // Record proxy request metrics
      proxyRequestDuration.observe({ proxy_type: "directory", status: String(upstreamRes.status) }, upstreamMs / 1000)

      // SYNC: Capture session creation/update to Metadata DB
      if (c.req.method === "POST" && incomingUrl.pathname === "/session" && upstreamRes.ok) {
        const cloned = upstreamRes.clone()
        cloned
          .json()
          .then(async (body: any) => {
            // Handle both raw Session object and Event-wrapped response
            const session = body?.properties?.info || body
            if (session?.id && session?.title) {
              const convex = getConvex()
              await convex
                .mutation(api.sessions.sync, {
                  workspaceId: resolved.workspaceId,
                  sessionId: session.id,
                  title: session.title,
                  slug: session.slug || session.id,
                  updatedAt: session.time?.updated || Date.now(),
                })
                .catch((err) => logJson("error", { kind: "session.sync.failed", error: String(err) }))
            }
          })
          .catch(() => {})
      }

      // SYNC: Capture session title updates (eg auto-title after first message)
      if (
        (c.req.method === "PATCH" || c.req.method === "PUT") &&
        incomingUrl.pathname.startsWith("/session/") &&
        incomingUrl.pathname.split("/").length === 3 &&
        upstreamRes.ok
      ) {
        const cloned = upstreamRes.clone()
        cloned
          .json()
          .then(async (body: any) => {
            const session = body?.properties?.info || body
            if (!session?.id) return

            if (session?.time?.archived) {
              await getConvex()
                .mutation(api.sessions.remove, { sessionId: session.id })
                .catch((err) => logJson("error", { kind: "session.remove.failed", error: String(err) }))
              return
            }

            if (!session?.title) return
            await getConvex()
              .mutation(api.sessions.sync, {
                workspaceId: resolved.workspaceId,
                sessionId: session.id,
                title: session.title,
                slug: session.slug || session.id,
                updatedAt: session.time?.updated || Date.now(),
              })
              .catch((err) => logJson("error", { kind: "session.sync.failed", error: String(err) }))
          })
          .catch(() => {})
      }

      // SYNC: Remove sessions from Metadata DB when deleted in sandbox
      if (c.req.method === "DELETE" && (upstreamRes.ok || upstreamRes.status === 404)) {
        const parts = incomingUrl.pathname.split("/")
        const id = parts[2] ?? ""
        if (parts[1] === "session" && parts.length === 3 && id) {
          getConvex()
            .mutation(api.sessions.remove, { sessionId: id })
            .catch((err) => logJson("error", { kind: "session.remove.failed", error: String(err) }))
        }
      }

      // Log error response bodies for debugging
      let errorBody: string | undefined
      if (upstreamRes.status >= 400 && upstreamRes.status < 500) {
        try {
          const cloned = upstreamRes.clone()
          errorBody = await cloned.text().catch(() => undefined)
        } catch {}
      }

      logJson("info", {
        reqId,
        kind: "proxy.response",
        workspaceId: resolved.workspaceId,
        status: upstreamRes.status,
        durationMs: nowMs() - t0,
        resolveMs,
        upstreamMs,
        ...(errorBody ? { errorBody: errorBody.slice(0, 500) } : {}),
      })

      const resHeaders = new Headers(upstreamRes.headers)
      resHeaders.delete("set-cookie")

      // Optimization: Cache agent/config requests for 5 minutes
      if (
        c.req.method === "GET" &&
        (incomingUrl.pathname.startsWith("/agent") || incomingUrl.pathname.startsWith("/config"))
      ) {
        resHeaders.set("cache-control", "public, max-age=300")
      }

      withDevCors(c.req.raw, resHeaders)

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: resHeaders,
      })
    } catch (err: any) {
      // Record error metric
      proxyRequestDuration.observe({ proxy_type: "directory", status: "502" }, 0)

      const headers = withDevCors(
        c.req.raw,
        new Headers({
          "content-type": "application/json",
        }),
      )
      return new Response(
        JSON.stringify({
          error: "Gateway request failed",
          message: err?.message || String(err),
          reqId,
        }),
        { status: 502, headers },
      )
    } finally {
      try {
        delete (globalThis as any).__claxedo_reqId
      } catch {}
    }
  }),
)
