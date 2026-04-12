import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api"
import type { MiddlewareHandler } from "hono"

export function veritlyHonoOtelMiddleware(tracerName: string): MiddlewareHandler {
  const tracer = trace.getTracer(tracerName)
  return async (c, next) => {
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
