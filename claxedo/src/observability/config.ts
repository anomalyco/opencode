/**
 * Observability Configuration
 * Centralized configuration for tracing, metrics, and error tracking
 */

export interface ObservabilityConfig {
  // OpenTelemetry
  otelEnabled: boolean;
  otelServiceName: string;
  otelExporterEndpoint: string;
  otelExporterHeaders: Record<string, string>;
  otelTraceSampleRate: number;

  // Prometheus
  prometheusEnabled: boolean;
  prometheusPath: string;

  // Sentry
  sentryEnabled: boolean;
  sentryDsn: string;
  sentryTracesSampleRate: number;
  sentryEnvironment: string;
}

function parseHeaders(headerString: string | undefined): Record<string, string> {
  if (!headerString) return {};
  const headers: Record<string, string> = {};
  for (const pair of headerString.split(",")) {
    const [key, ...valueParts] = pair.split("=");
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join("=").trim();
    }
  }
  return headers;
}

export function getObservabilityConfig(): ObservabilityConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  return {
    // OpenTelemetry
    otelEnabled: process.env.OTEL_ENABLED === "true",
    otelServiceName: process.env.OTEL_SERVICE_NAME || "claxedo-gateway",
    otelExporterEndpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
    otelExporterHeaders: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    otelTraceSampleRate: Number.parseFloat(
      process.env.OTEL_TRACE_SAMPLE_RATE || (isProduction ? "0.1" : "1.0")
    ),

    // Prometheus
    prometheusEnabled: process.env.PROMETHEUS_ENABLED !== "false",
    prometheusPath: process.env.PROMETHEUS_PATH || "/metrics",

    // Sentry
    sentryEnabled: process.env.SENTRY_ENABLED === "true",
    sentryDsn: process.env.SENTRY_DSN || "",
    sentryTracesSampleRate: Number.parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || (isProduction ? "0.1" : "1.0")
    ),
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT || nodeEnv,
  };
}

export const observabilityConfig = getObservabilityConfig();
