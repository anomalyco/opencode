/**
 * W3C Trace Context Propagation
 * Helpers for propagating trace context across service boundaries
 */
import {
  context,
  propagation,
  trace,
  type Context,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";

/**
 * Inject trace context into headers for outgoing HTTP requests
 */
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers };
  propagation.inject(context.active(), result);
  return result;
}

/**
 * Extract trace context from incoming HTTP headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context {
  // Normalize headers to string values
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = value[0];
    }
  }
  return propagation.extract(context.active(), normalized);
}

/**
 * Create a linked span in the current context
 * Useful for async operations that should be linked to the original request
 */
export function createLinkedSpan(
  name: string,
  linkedSpanContext?: SpanContext
): Span {
  const tracer = trace.getTracer("claxedo-gateway");
  return tracer.startSpan(name, {
    links: linkedSpanContext ? [{ context: linkedSpanContext }] : undefined,
  });
}

/**
 * Get the current span from context
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getSpan(context.active());
}

/**
 * Get the current span context
 */
export function getCurrentSpanContext(): SpanContext | undefined {
  return trace.getSpan(context.active())?.spanContext();
}

/**
 * Encode trace context for WebSocket connections (query param)
 * Since browsers can't set custom headers on WebSocket connections,
 * we encode the trace context in a query parameter
 */
export function encodeTraceContextForWs(): string | null {
  const spanContext = getCurrentSpanContext();
  if (!spanContext || !spanContext.traceId || !spanContext.spanId) {
    return null;
  }

  const data = {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };

  // Base64url encode
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

/**
 * Decode trace context from WebSocket query param
 */
export function decodeTraceContextFromWs(encoded: string): SpanContext | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8");
    const data = JSON.parse(decoded);

    if (!data.traceId || !data.spanId) {
      return null;
    }

    return {
      traceId: data.traceId,
      spanId: data.spanId,
      traceFlags: data.traceFlags ?? 0,
      isRemote: true,
    };
  } catch {
    return null;
  }
}

/**
 * Create a context with an extracted span context as parent
 */
export function createContextWithParent(parentSpanContext: SpanContext): Context {
  const parentSpan = trace.wrapSpanContext(parentSpanContext);
  return trace.setSpan(context.active(), parentSpan);
}

/**
 * Get traceparent header value for W3C trace context
 */
export function getTraceparentHeader(): string | null {
  const spanContext = getCurrentSpanContext();
  if (!spanContext || !spanContext.traceId || !spanContext.spanId) {
    return null;
  }

  // Format: {version}-{trace-id}-{parent-id}-{trace-flags}
  const version = "00";
  const traceFlags = (spanContext.traceFlags ?? 0).toString(16).padStart(2, "0");
  return `${version}-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`;
}

/**
 * Parse traceparent header value
 */
export function parseTraceparentHeader(traceparent: string): SpanContext | null {
  const parts = traceparent.split("-");
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, traceFlags] = parts;

  // Validate format
  if (version !== "00" || traceId.length !== 32 || spanId.length !== 16) {
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags: parseInt(traceFlags, 16),
    isRemote: true,
  };
}
