/**
 * Sentry Error Capture Middleware
 * Captures unhandled errors and adds request context
 */
import type { MiddlewareHandler } from "hono";
import * as Sentry from "@sentry/node";
import type { GatewayContext } from "../../server/context.ts";
import { observabilityConfig } from "../config.ts";
import { getTraceId, getSpanId } from "../tracing/middleware.ts";

/**
 * Sentry middleware for Hono
 * Captures errors and adds request context to Sentry events
 */
export const sentryMiddleware = (): MiddlewareHandler<GatewayContext> => {
  return async (c, next) => {
    if (!observabilityConfig.sentryEnabled) {
      return next();
    }

    // Set request context for Sentry
    Sentry.setContext("request", {
      method: c.req.method,
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers),
    });

    // Add trace context
    const traceId = getTraceId();
    const spanId = getSpanId();
    if (traceId) {
      Sentry.setTag("trace_id", traceId);
    }
    if (spanId) {
      Sentry.setTag("span_id", spanId);
    }

    // Add request ID from context
    const reqId = c.get("reqId");
    if (reqId) {
      Sentry.setTag("request_id", reqId);
    }

    try {
      await next();
    } catch (error) {
      // Capture the error with full context
      Sentry.captureException(error, {
        tags: {
          method: c.req.method,
          route: new URL(c.req.url).pathname,
          status: String(c.res?.status ?? 500),
        },
        extra: {
          request_id: reqId,
          trace_id: traceId,
          span_id: spanId,
        },
      });

      // Re-throw to let Hono's error handler deal with it
      throw error;
    }
  };
};

/**
 * Error handler that integrates with Sentry
 * Use as Hono's onError handler
 */
export function sentryErrorHandler(err: Error, c: any): Response {
  const traceId = getTraceId();
  const reqId = c.get?.("reqId");

  // Capture to Sentry
  if (observabilityConfig.sentryEnabled) {
    Sentry.captureException(err, {
      tags: {
        method: c.req?.method,
        route: c.req?.url ? new URL(c.req.url).pathname : undefined,
      },
      extra: {
        request_id: reqId,
        trace_id: traceId,
      },
    });
  }

  // Return error response
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as any).status ?? 500;

  return c.json(
    {
      error: message,
      requestId: reqId,
      traceId,
    },
    { status }
  );
}
