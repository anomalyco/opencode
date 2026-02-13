/**
 * Hono Metrics Middleware
 * Collects HTTP request metrics for Prometheus
 */
import type { MiddlewareHandler } from "hono";
import type { GatewayContext } from "../../server/context.ts";
import { httpRequestDuration, httpRequestsTotal } from "./definitions.ts";

/**
 * Normalize route path for metric labels
 * Replaces dynamic segments with placeholders to prevent high cardinality
 */
function normalizeRoute(path: string): string {
  // Replace UUID patterns
  let normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ":id"
  );

  // Replace workspace IDs (Convex IDs are base32-ish)
  normalized = normalized.replace(/\/w\/[a-z0-9]+/gi, "/w/:workspaceId");

  // Replace PTY IDs
  normalized = normalized.replace(/\/pty\/[a-z0-9_-]+/gi, "/pty/:ptyId");

  // Replace session IDs
  normalized = normalized.replace(/\/session\/[a-z0-9_-]+/gi, "/session/:sessionId");

  // Replace project IDs
  normalized = normalized.replace(/\/project\/[a-z0-9_-]+/gi, "/project/:projectId");

  // Replace numeric IDs
  normalized = normalized.replace(/\/\d+/g, "/:id");

  return normalized;
}

/**
 * Metrics middleware for Hono
 * Tracks request count and duration
 */
export const metricsMiddleware = (): MiddlewareHandler<GatewayContext> => {
  return async (c, next) => {
    const startTime = process.hrtime.bigint();
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    // Skip metrics endpoint itself to avoid recursion
    if (path === "/metrics") {
      return next();
    }

    try {
      await next();
    } finally {
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;

      const status = c.res?.status ?? 0;
      const route = normalizeRoute(path);

      // Record metrics
      httpRequestDuration.observe(
        { method, route, status: String(status) },
        durationSeconds
      );
      httpRequestsTotal.inc({ method, route, status: String(status) });
    }
  };
};

/**
 * Record a custom metric duration
 * Helper for instrumenting specific operations
 */
export function recordDuration(
  histogram: { observe: (labels: Record<string, string>, value: number) => void },
  labels: Record<string, string>,
  durationMs: number
): void {
  histogram.observe(labels, durationMs / 1000);
}

/**
 * Create a timer for measuring operation duration
 */
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e9;
  };
}
