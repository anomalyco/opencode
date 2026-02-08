/**
 * Trace Context Extraction
 * Extract trace context from incoming requests for distributed tracing
 */
import { context, propagation, trace, type Context, type SpanContext } from "@opentelemetry/api";

/**
 * Extract trace context from incoming HTTP headers
 * Supports W3C traceparent header format
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
 * Decode trace context from WebSocket query param
 * Gateway encodes trace context in base64url for WebSocket connections
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
 * Parse traceparent header value (W3C Trace Context format)
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

/**
 * Extract trace context from WebSocket URL query params
 */
export function extractTraceContextFromUrl(url: URL): Context {
  const traceParam = url.searchParams.get("trace");
  if (!traceParam) {
    return context.active();
  }

  const spanContext = decodeTraceContextFromWs(traceParam);
  if (!spanContext) {
    return context.active();
  }

  return createContextWithParent(spanContext);
}

/**
 * Get current span context
 */
export function getCurrentSpanContext(): SpanContext | undefined {
  return trace.getSpan(context.active())?.spanContext();
}
