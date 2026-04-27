import { Provider } from "@/provider/provider"
import { NamedError } from "@opencode-ai/core/util/error"
import { NotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"

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
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

  if (c.req.query("auth_token")) c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)

  return basicAuth({ username, password })(c, next)
}

export const LoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const skip = c.req.path === "/log"
  if (!skip) {
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
    })
  }
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })
  await next()
  if (!skip) timer.stop()
}

export function CorsMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (!input) return

      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input
      if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
        return input

      if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) return input
      if (opts?.cors?.includes(input)) return input
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
