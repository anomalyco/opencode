/**
 * OpenCode Server Observability Module
 * Lightweight tracing support for the OpenCode server running inside sandboxes
 */
import { trace, context, SpanKind, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { extractTraceContext, decodeTraceContextFromWs, createContextWithParent } from "./context.ts";

// Configuration
const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "opencode-server";

let tracer: Tracer | null = null;

/**
 * Initialize lightweight tracing for OpenCode server
 * This doesn't set up full OTEL SDK - just provides trace propagation support
 */
export function initTracing(): void {
  if (!OTEL_ENABLED) {
    return;
  }

  tracer = trace.getTracer(SERVICE_NAME);
  console.log(`[OpenCode Observability] Tracing initialized (service: ${SERVICE_NAME})`);
}

/**
 * Get the global tracer instance
 */
export function getTracer(): Tracer {
  if (!tracer) {
    // Return the global tracer (works even without SDK init)
    return trace.getTracer(SERVICE_NAME);
  }
  return tracer;
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): Promise<T> {
  const currentTracer = getTracer();
  const span = currentTracer.startSpan(name, {
    kind: options?.kind ?? SpanKind.INTERNAL,
    attributes: options?.attributes,
  });

  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
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
}

/**
 * Execute a synchronous function within a span context
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): T {
  const currentTracer = getTracer();
  const span = currentTracer.startSpan(name, {
    kind: options?.kind ?? SpanKind.INTERNAL,
    attributes: options?.attributes,
  });

  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
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
}

/**
 * Get current trace ID for logging correlation
 */
export function getTraceId(): string | null {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId ?? null;
}

/**
 * Get current span ID for logging correlation
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

/**
 * Simple timer utility for measuring durations
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => (performance.now() - start) / 1000; // Return seconds
}

// Re-export context utilities
export { extractTraceContext, decodeTraceContextFromWs, createContextWithParent };
export { trace, context, SpanKind, SpanStatusCode };
export type { Span, Tracer };
