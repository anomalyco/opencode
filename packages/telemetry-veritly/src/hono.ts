import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api"
import type { MiddlewareHandler } from "hono"

/** High-frequency routes that pollute Axiom; extend with `VERITLY_OTEL_HTTP_SKIP_PATHS=/a,/b` (exact path match). */
function veritlySkipHonoHttpSpan(c: { req: { method: string; path: string } }): boolean {
  if (c.req.method === "OPTIONS") return true
  if (c.req.path === "/global/readyz") return true
  const raw = process.env.VERITLY_OTEL_HTTP_SKIP_PATHS?.trim()
  if (!raw) return false
  for (const p of raw.split(",")) {
    const t = p.trim()
    if (t && c.req.path === t) return true
  }
  return false
}

export function veritlyHonoOtelMiddleware(tracerName: string): MiddlewareHandler {
  const tracer = trace.getTracer(tracerName)
  return async (c, next) => {
    if (veritlySkipHonoHttpSpan(c)) {
      return next()
    }
    const carrier: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      carrier[key] = value
    })
    const parentCtx = propagation.extract(context.active(), carrier)

    await context.with(parentCtx, async () => {
      const span = tracer.startSpan(`${c.req.method} ${c.req.path}`, {
        attributes: {
          "http.method": c.req.method,
          "http.route": c.req.path,
          "http.scheme": new URL(c.req.url).protocol.replace(":", ""),
        },
      })
      const projectId = c.req.header("x-veritly-project-id")?.trim()
      if (projectId) span.setAttribute("veritly.project_id", projectId)

      const active = trace.setSpan(context.active(), span)
      await context.with(active, async () => {
        try {
          await next()
          const status = c.res.status
          if (typeof status === "number") {
            span.setAttribute("http.status_code", status)
            if (status >= 400) span.setStatus({ code: SpanStatusCode.ERROR })
          }
        } catch (err) {
          span.recordException(err as Error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
          throw err
        } finally {
          span.end()
        }
      })
    })
  }
}
