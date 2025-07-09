import * as SemanticConventions from "@opentelemetry/semantic-conventions"
import * as otel from "./otel"
import type { Hono } from "hono"
import { addTelemetryMiddleware } from "./hono-middleware"

/**
 * A Telemetry module for performance monitoring and tracing.
 *
 * This is disabled by default, and requires an env var ("OTEL_EXPORTER_OTLP_ENDPOINT=http://...") to
 * enable.
 */
export namespace Telemetry {
  export const init = otel.init
  export const traced = otel.traced
  export const newSpan = otel.newSpan
  export const setAttributes = otel.setAttributes
  export const otelContextAsEnvVars = otel.otelContextAsEnvVars

  export const Attributes = SemanticConventions

  /**
   * Registers a Hono middleware for OpenTelemetry tracing,
   * if tracing is enabled.
   */
  export const registerHonoMiddleware = (hono: Hono) => {
    if (otel.getEndpoint()) {
      addTelemetryMiddleware(hono)
    }
  }
}
