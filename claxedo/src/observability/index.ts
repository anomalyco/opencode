/**
 * Observability Module Entry Point
 * Initialize and shutdown all observability components
 */

// Configuration
export { observabilityConfig, getObservabilityConfig } from "./config.ts"
export type { ObservabilityConfig } from "./config.ts"

// Tracing
export {
  initTracing,
  shutdownTracing,
  getTracer,
  startSpan,
  withSpan,
  withSpanSync,
  trace,
  context,
  SpanKind,
  SpanStatusCode,
} from "./tracing/index.ts"
export type { Span, Tracer } from "./tracing/index.ts"

export { tracingMiddleware, getTraceId, getSpanId, addSpanEvent, setSpanAttributes } from "./tracing/middleware.ts"

export {
  injectTraceContext,
  extractTraceContext,
  encodeTraceContextForWs,
  decodeTraceContextFromWs,
  getCurrentSpan,
  getCurrentSpanContext,
  getTraceparentHeader,
  parseTraceparentHeader,
  createContextWithParent,
} from "./tracing/propagation.ts"

// Metrics
export {
  metricsRegistry,
  httpRequestDuration,
  httpRequestsTotal,
  sandboxCreationDuration,
  sandboxCreationsTotal,
  activeSandboxes,
  workspaceCreationDuration,
  workspaceWakeDuration,
  workspaceDeletionDuration,
  sessionCreationDuration,
  activeSessions,
  ptyCreationDuration,
  ptyFirstByteDuration,
  websocketConnectionsActive,
  websocketMessagesTotal,
  websocketMessageLatency,
  websocketConnectionDuration,
  daytonaApiDuration,
  convexQueryDuration,
  proxyRequestDuration,
  proxyResolutionDuration,
  credentialSyncDuration,
  credentialSyncTotal,
} from "./metrics/definitions.ts"

export { metricsMiddleware, recordDuration, startTimer } from "./metrics/middleware.ts"
export { MetricsRoutes, getMetricsJson } from "./metrics/endpoint.ts"

// Sentry
export {
  initSentry,
  shutdownSentry,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  Sentry,
} from "./sentry/index.ts"

export { sentryMiddleware, sentryErrorHandler } from "./sentry/middleware.ts"

/**
 * Initialize all observability components
 */
export async function initObservability(): Promise<void> {
  const { initTracing } = await import("./tracing/index.ts")
  const { initSentry } = await import("./sentry/index.ts")

  console.log("[Observability] Initializing...")
  initTracing()
  initSentry()
  console.log("[Observability] Initialization complete")
}

/**
 * Shutdown all observability components gracefully
 */
export async function shutdownObservability(): Promise<void> {
  const { shutdownTracing } = await import("./tracing/index.ts")
  const { shutdownSentry } = await import("./sentry/index.ts")

  console.log("[Observability] Shutting down...")
  await Promise.all([shutdownTracing(), shutdownSentry()])
  console.log("[Observability] Shutdown complete")
}
