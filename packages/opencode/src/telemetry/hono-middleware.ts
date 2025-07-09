import * as SemanticConventions from "@opentelemetry/semantic-conventions"
import type { Hono } from "hono"
import { traced } from "./otel"
import { context, propagation } from "@opentelemetry/api"

/**
 * Creates a Hono middleware that creates a span on each request
 * and connects it to the OpenTelemetry context provided in headers
 * for distributed tracing.
 */
export const addTelemetryMiddleware = (hono: Hono) =>
  hono.use("*", async (c, next) => {
    // for now we should ignore logs
    if (c.req.method === "POST" && c.req.path === "/log") {
      return next()
    }

    const headerCarrier = Object.create(null) as Record<string, string>
    const headersAttrs = {} as Record<string, string>
    c.req.raw.headers.forEach((value, key) => {
      headerCarrier[key.toLowerCase()] = value
      headersAttrs[SemanticConventions.ATTR_HTTP_REQUEST_HEADER(key)] = value
    })
    const activeContext = context.active()
    const parentContext = propagation.extract(activeContext, headerCarrier)

    return traced(`${c.req.method} ${c.req.path}`, next, {
      context: parentContext,
      attributes: {
        [SemanticConventions.ATTR_HTTP_REQUEST_METHOD]: c.req.method,
        [SemanticConventions.ATTR_HTTP_ROUTE]: c.req.path,
        [SemanticConventions.ATTR_USER_AGENT_ORIGINAL]: c.req.header("User-Agent") || "",
        ...headersAttrs,
      },
    })
  })
