/**
 * Hono Tracing Middleware
 * Adds OpenTelemetry tracing to HTTP requests
 */
import type { MiddlewareHandler } from "hono";
import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { GatewayContext } from "../../server/context.ts";
import { extractTraceContext } from "./propagation.ts";
import { getTracer } from "./index.ts";

/**
 * Tracing middleware for Hono
 * Creates a span for each HTTP request and propagates context
 */
export const tracingMiddleware = (): MiddlewareHandler<GatewayContext> => {
  return async (c, next) => {
    const tracer = getTracer();
    const url = new URL(c.req.url);
    const method = c.req.method;
    const route = url.pathname;

    // Extract trace context from incoming request headers
    const headers: Record<string, string | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const parentContext = extractTraceContext(headers);

    // Create span with parent context
    const span = tracer.startSpan(
      `${method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.method": method,
          "http.url": c.req.url,
          "http.route": route,
          "http.scheme": url.protocol.replace(":", ""),
          "http.host": url.host,
          "http.user_agent": c.req.header("user-agent") || "",
        },
      },
      parentContext
    );

    // Store span context for downstream use
    const ctx = trace.setSpan(parentContext, span);

    // Add trace ID to request context for logging correlation
    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;

    try {
      // Execute the request within the span context
      const result = await context.with(ctx, async () => {
        await next();
      });

      // Set response attributes
      const status = c.res.status;
      span.setAttribute("http.status_code", status);

      // Set span status based on HTTP status
      if (status >= 400 && status < 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      } else if (status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      // Add trace headers to response for debugging
      c.header("x-trace-id", traceId);
      c.header("x-span-id", spanId);

      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  };
};

/**
 * Get the current trace ID from context (for logging)
 */
export function getTraceId(): string | null {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId ?? null;
}

/**
 * Get the current span ID from context (for logging)
 */
export function getSpanId(): string | null {
  const span = trace.getSpan(context.active());
  return span?.spanContext().spanId ?? null;
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getSpan(context.active());
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Add attributes to the current span
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getSpan(context.active());
  if (span) {
    span.setAttributes(attributes);
  }
}
