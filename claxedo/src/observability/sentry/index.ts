/**
 * Sentry Error Tracking Setup
 * Initializes Sentry for error monitoring and performance tracking
 */
import * as Sentry from "@sentry/node";
import { observabilityConfig } from "../config.ts";
import { getTraceId, getSpanId } from "../tracing/middleware.ts";

let initialized = false;

/**
 * Initialize Sentry error tracking
 */
export function initSentry(): void {
  if (!observabilityConfig.sentryEnabled || !observabilityConfig.sentryDsn) {
    console.log("[Observability] Sentry disabled");
    return;
  }

  Sentry.init({
    dsn: observabilityConfig.sentryDsn,
    environment: observabilityConfig.sentryEnvironment,
    tracesSampleRate: observabilityConfig.sentryTracesSampleRate,

    // Integrate with OpenTelemetry trace IDs
    beforeSend(event) {
      // Add trace ID to event for correlation
      const traceId = getTraceId();
      const spanId = getSpanId();

      if (traceId) {
        event.tags = {
          ...event.tags,
          trace_id: traceId,
        };
      }
      if (spanId) {
        event.tags = {
          ...event.tags,
          span_id: spanId,
        };
      }

      return event;
    },

    // Filter out noisy errors
    ignoreErrors: [
      // Network errors that are expected
      "ECONNRESET",
      "EPIPE",
      "ETIMEDOUT",
      // Client-side errors
      "ResizeObserver loop limit exceeded",
    ],
  });

  initialized = true;
  console.log(
    `[Observability] Sentry initialized: ${observabilityConfig.sentryEnvironment} (traces: ${observabilityConfig.sentryTracesSampleRate})`
  );
}

/**
 * Shutdown Sentry gracefully
 */
export async function shutdownSentry(): Promise<void> {
  if (initialized) {
    await Sentry.close(2000);
    initialized = false;
    console.log("[Observability] Sentry shutdown complete");
  }
}

/**
 * Capture an exception with context
 */
export function captureException(
  error: Error,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: { id: string; email?: string };
  }
): string {
  const traceId = getTraceId();

  return Sentry.captureException(error, {
    tags: {
      ...context?.tags,
      ...(traceId ? { trace_id: traceId } : {}),
    },
    extra: context?.extra,
    user: context?.user,
  });
}

/**
 * Capture a message/log with context
 */
export function captureMessage(
  message: string,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
): string {
  const traceId = getTraceId();

  return Sentry.captureMessage(message, {
    level,
    tags: {
      ...context?.tags,
      ...(traceId ? { trace_id: traceId } : {}),
    },
    extra: context?.extra,
  });
}

/**
 * Set user context for subsequent events
 */
export function setUser(user: { id: string; email?: string; organizationId?: string }): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    ...(user.organizationId ? { organization_id: user.organizationId } : {}),
  });
}

/**
 * Clear user context
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info"
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

// Re-export Sentry for advanced usage
export { Sentry };
