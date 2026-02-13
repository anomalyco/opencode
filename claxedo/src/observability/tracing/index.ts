/**
 * OpenTelemetry Tracing Setup
 * Initializes the OTEL SDK for distributed tracing
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
// Use string constants for compatibility across semantic-conventions versions
const ATTR_SERVICE_NAME = "service.name";
const ATTR_SERVICE_VERSION = "service.version";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-node";
import { trace, context, SpanKind, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { observabilityConfig } from "../config.ts";

let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;

/**
 * Initialize OpenTelemetry tracing
 */
export function initTracing(): void {
  if (!observabilityConfig.otelEnabled) {
    console.log("[Observability] OTEL tracing disabled");
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: `${observabilityConfig.otelExporterEndpoint}/v1/traces`,
    headers: observabilityConfig.otelExporterHeaders,
  });

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: observabilityConfig.otelServiceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || "development",
  });

  // Use ratio-based sampling with parent-based strategy
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(observabilityConfig.otelTraceSampleRate),
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        scheduledDelayMillis: 5000, // 5 second flush interval
        exportTimeoutMillis: 30000,
        maxExportBatchSize: 512,
      }),
    ],
    sampler,
  });

  sdk.start();
  tracer = trace.getTracer(observabilityConfig.otelServiceName);
  console.log(
    `[Observability] OTEL tracing initialized: ${observabilityConfig.otelExporterEndpoint} (sample rate: ${observabilityConfig.otelTraceSampleRate})`
  );
}

/**
 * Shutdown tracing gracefully
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
    tracer = null;
    console.log("[Observability] OTEL tracing shutdown complete");
  }
}

/**
 * Get the global tracer instance
 */
export function getTracer(): Tracer {
  if (!tracer) {
    // Return a no-op tracer if not initialized
    return trace.getTracer("noop");
  }
  return tracer;
}

/**
 * Create a new span for an operation
 */
export function startSpan(
  name: string,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): Span {
  return getTracer().startSpan(name, {
    kind: options?.kind ?? SpanKind.INTERNAL,
    attributes: options?.attributes,
  });
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
  const span = startSpan(name, options);
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
  const span = startSpan(name, options);
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

// Re-export useful types and utilities
export { trace, context, SpanKind, SpanStatusCode };
export type { Span, Tracer };
