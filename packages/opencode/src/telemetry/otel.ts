import { NodeSDK } from "@opentelemetry/sdk-node"
import * as SemanticConventions from "@opentelemetry/semantic-conventions"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { trace, context, SpanStatusCode, SpanKind, type Span, type Context, propagation } from "@opentelemetry/api"
import { Log } from "../util/log"
import { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } from "@opentelemetry/core"
import { resourceFromAttributes } from "@opentelemetry/resources"

const tracer = trace.getTracer("opencode-server")

export const log = Log.create({ service: "telemetry" })

export function getEndpoint(): string | undefined {
  return process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
}

/**
 * Initializes OpenTelemetry with the given service name and version.
 * It sets up the OpenTelemetry SDK, configures the propagators, and starts the
 * SDK.
 *
 * When the provided AbortSignal is aborted, it gracefully shuts down the SDK.
 */
export function init({ name, version, signal }: { name: string; version: string; signal: AbortSignal }): void {
  const endpoint = getEndpoint()
  if (!endpoint) {
    log.info("Not initializing OTEL - no endpoint configured")
    return
  }

  log.info("Initializing OpenTelemetry", { endpoint, name, version })

  try {
    process.env["OTEL_SERVICE_NAME"] = name
    process.env["OTEL_SERVICE_VERSION"] = version

    const textMapPropagator = new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    })

    const sdk = new NodeSDK({
      instrumentations: [getNodeAutoInstrumentations()],
      textMapPropagator,
      resource: resourceFromAttributes({
        [SemanticConventions.ATTR_SERVICE_NAME]: name,
        [SemanticConventions.ATTR_SERVICE_VERSION]: version,
      }),
    })

    signal.addEventListener(
      "abort",
      () => {
        try {
          sdk.shutdown()
          log.info("OpenTelemetry shutdown successfully")
        } catch (error) {
          log.error("Failed to shutdown OpenTelemetry", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
      { once: true },
    )
    sdk.start()

    // Explicitly set the global propagator
    propagation.setGlobalPropagator(textMapPropagator)

    log.info("OpenTelemetry initialized successfully")
  } catch (error) {
    log.error("Failed to initialize OpenTelemetry", { error: error instanceof Error ? error.message : String(error) })
  }
}

export interface TraceConfig {
  attributes?: Record<string, string | number | boolean>
  kind?: SpanKind
  context?: Context
}

/**
 * Executes a function within an OpenTelemetry span context.
 * It creates a new span with the given name, passes the span context to the function,
 * and automatically handles span completion and error status.
 *
 * The function accepts optional TraceConfig to configure the span with
 * additional attributes or span kind.
 *
 * If the function returns an error, the span status is set to Error with the error message.
 * Otherwise, the span status is set to Ok.
 *
 * Example usage:
 *
 * ```typescript
 * const result = await Telemetry.traced("database-query", async () => {
 *   return await db.query("SELECT * FROM users")
 * }, {
 *   attributes: { "query.table": "users" },
 *   kind: SpanKind.CLIENT
 * })
 * ```
 */
export async function traced<T>(name: string, fn: (span: Span) => Promise<T>, config?: TraceConfig): Promise<T> {
  const { span, close, inContext } = newSpan(name, config)

  try {
    const result = await inContext(() => fn(span))
    close()
    return result
  } catch (error) {
    close(error as Error)
    throw error
  }
}

export function newSpan(name: string, config?: TraceConfig) {
  const span = tracer.startSpan(
    name,
    {
      kind: config?.kind || SpanKind.INTERNAL,
      attributes: config?.attributes,
    },
    config?.context,
  )

  const ctx = trace.setSpan(config?.context ?? context.active(), span)

  return {
    context: ctx,
    span,
    inContext: <T>(fn: () => Promise<T>) => {
      return context.with(ctx, () => fn())
    },
    close(error?: unknown) {
      if (!error) {
        span.setStatus({ code: SpanStatusCode.OK })
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      span.end()
    },
  }
}

/**
 * Sets attributes on the currently active span, if one exists.
 */
export function setAttributes(attributes: Record<string, string | number | boolean>) {
  const span = trace.getActiveSpan()
  if (span) {
    span.setAttributes(attributes)
  }
}

/**
 * Extract trace context from current span and convert to JSON environment variable
 * for propagation to the Go TUI process
 */
export function otelContextAsEnvVars(): Record<string, string> {
  if (!getEndpoint()) {
    return {}
  }

  const headers: Record<string, string> = {}

  // Get current active span context
  const activeSpan = trace.getActiveSpan()
  if (!activeSpan) {
    return headers
  }

  const spanContext = activeSpan.spanContext()
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return headers
  }

  const traceId = spanContext.traceId
  const spanId = spanContext.spanId
  const traceFlags = spanContext.traceFlags || 0

  // Create a single JSON environment variable with all trace context
  const traceContext = {
    traceId,
    spanId,
    traceFlags,
    traceparent: `00-${traceId}-${spanId}-${traceFlags.toString(16).padStart(2, "0")}`,
  }

  headers["OTEL_TRACE_CONTEXT"] = JSON.stringify(traceContext)

  return headers
}
