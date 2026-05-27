import { Provider } from "@/provider/provider"
import { NamedError } from "@yunpat/core/util/error"
import { NotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import * as Log from "@yunpat/core/util/log"
import { Flag } from "@yunpat/core/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"
import * as ServerBackend from "./backend"
import { isAllowedCorsOrigin, type CorsOptions } from "./cors"
import { isPtyConnectPath, PTY_CONNECT_TICKET_QUERY } from "./shared/pty-ticket"
import { isPublicUIPath } from "./shared/public-ui"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  const message = err instanceof Error && err.stack ? err.stack : err.toString()
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}

export const AuthMiddleware: MiddlewareHandler = (c, next) => {
  // Allow CORS preflight requests to succeed without auth.
  // Browser clients sending Authorization headers will preflight with OPTIONS.
  if (c.req.method === "OPTIONS") return next()
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()
  if (isPublicUIPath(c.req.method, c.req.path)) return next()
  if (isPtyConnectPath(c.req.path) && c.req.query(PTY_CONNECT_TICKET_QUERY)) return next()
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

  if (c.req.query("auth_token")) c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)

  return basicAuth({ username, password })(c, next)
}

export function LoggerMiddleware(backendAttributes: ServerBackend.Attributes): MiddlewareHandler {
  return async (c, next) => {
    const skip = c.req.path === "/log"
    if (skip) return next()
    const attributes = {
      method: c.req.method,
      path: c.req.path,
      // If this logger grows full-URL fields, redact auth_token and ticket query params.
      ...backendAttributes,
    }
    log.info("request", attributes)
    const timer = log.time("request", attributes)
    await next()
    timer.stop()
  }
}

export function CorsMiddleware(opts?: CorsOptions): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (isAllowedCorsOrigin(input, opts)) return input
    },
  })
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}

const SSE_PATHS = new Set(["/event", "/global/event"])
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 100

function cleanupRateLimitBuckets() {
  const now = Date.now()
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key)
  }
}

export const RateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  if (SSE_PATHS.has(c.req.path)) return next()
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown"
  const key = `${ip}:${c.req.path}`
  const now = Date.now()
  let bucket = rateLimitBuckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    cleanupRateLimitBuckets()
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitBuckets.set(key, bucket)
  }
  bucket.count++
  if (bucket.count > RATE_LIMIT_MAX) {
    return c.json({ error: "Too many requests" }, { status: 429 })
  }
  return next()
}
