import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import type { LogRecordExporter } from "@opentelemetry/sdk-logs"
import type { SpanExporter } from "@opentelemetry/sdk-trace-base"
import { FetchOtlpLogExporter, FetchOtlpTraceExporter } from "./fetch-otlp-exporters.js"
import type { OtlpHttpExporterConfig } from "./otlp.js"

/**
 * Bun: default OTLP uses Node `http` → flaky; official browser exporters mix CJS/ESM under Bun.
 * Use `fetch` + JSON OTLP (`FetchOtlp*Exporter`). Node keeps stock exporters.
 */
export function useFetchOtlpExporters(): boolean {
  if (process.env.VERITLY_OTLP_USE_FETCH?.trim() === "1") return true
  if (process.env.VERITLY_OTLP_USE_FETCH?.trim() === "0") return false
  return typeof process !== "undefined" && Boolean(process.versions?.bun)
}

export function createOtlpTraceExporter(config: OtlpHttpExporterConfig): SpanExporter {
  return useFetchOtlpExporters() ? new FetchOtlpTraceExporter(config) : new OTLPTraceExporter(config)
}

export function createOtlpLogExporter(config: OtlpHttpExporterConfig): LogRecordExporter {
  return useFetchOtlpExporters() ? new FetchOtlpLogExporter(config) : new OTLPLogExporter(config)
}
