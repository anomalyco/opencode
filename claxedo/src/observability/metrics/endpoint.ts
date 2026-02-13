/**
 * Prometheus Metrics Endpoint
 * GET /metrics handler for Prometheus scraping
 */
import { Hono } from "hono";
import { metricsRegistry } from "./definitions.ts";
import { observabilityConfig } from "../config.ts";

/**
 * Create metrics routes
 */
export function MetricsRoutes(): Hono {
  const app = new Hono();

  app.get(observabilityConfig.prometheusPath, async (c) => {
    try {
      const metrics = await metricsRegistry.metrics();
      c.header("Content-Type", metricsRegistry.contentType);
      return c.body(metrics);
    } catch (error) {
      console.error("[Metrics] Failed to collect metrics:", error);
      return c.text("Error collecting metrics", 500);
    }
  });

  return app;
}

/**
 * Get current metric values as JSON (for debugging)
 */
export async function getMetricsJson(): Promise<Record<string, unknown>> {
  const metrics = await metricsRegistry.getMetricsAsJSON();
  return metrics as unknown as Record<string, unknown>;
}
