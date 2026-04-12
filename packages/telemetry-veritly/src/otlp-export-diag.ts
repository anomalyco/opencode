import { diag } from "@opentelemetry/api"
import { ExportResultCode, type ExportResult } from "@opentelemetry/core"
import type { LogRecordExporter } from "@opentelemetry/sdk-logs"
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs"
import type { SpanExporter } from "@opentelemetry/sdk-trace-base"
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"

/** Set `VERITLY_OTLP_EXPORT_DEBUG=1` to log every OTLP HTTP export (start, duration, outcome, errors). */
export function isOtlpExportDebugEnabled(): boolean {
  return process.env.VERITLY_OTLP_EXPORT_DEBUG?.trim() === "1"
}

function logExportResult(
  kind: string,
  target: string,
  started: number,
  result: ExportResult,
  timeoutMillis: number,
): void {
  const ms = Date.now() - started
  if (result.code === ExportResultCode.SUCCESS) {
    diag.info(`[veritly] OTLP ${kind} export ok`, { target, ms, timeoutMillis })
    return
  }
  const earlyClose =
    result.error?.message === "Request timed out" && ms + 500 < timeoutMillis
  diag.error(`[veritly] OTLP ${kind} export failed`, {
    target,
    ms,
    timeoutMillis,
    code: result.code,
    errorMessage: result.error?.message,
    errorName: result.error?.name,
    stack: result.error?.stack,
    hint: earlyClose
      ? `OTLP maps request "close" to this message — failed in ${ms}ms while timeoutMillis=${timeoutMillis} (not a full HTTP wait). Check TLS/proxy/RST/IPv6; compare fetch vs node https. Run: bun run otlp:connectivity (telemetry-veritly)`
      : undefined,
  })
}

/** Wraps the OTLP span exporter so each HTTP attempt is visible in `diag` when debug is enabled. */
export function wrapSpanExporterWithOtlpDiag(
  inner: SpanExporter,
  kind: string,
  target: string,
  enabled: boolean,
  timeoutMillis: number,
): SpanExporter {
  if (!enabled) return inner
  return {
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      const started = Date.now()
      diag.info(`[veritly] OTLP ${kind} export start`, {
        target,
        itemCount: spans.length,
        timeoutMillis,
        runtime: process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`,
      })
      inner.export(spans, (result) => {
        logExportResult(kind, target, started, result, timeoutMillis)
        resultCallback(result)
      })
    },
    shutdown() {
      return inner.shutdown()
    },
    forceFlush() {
      return inner.forceFlush?.() ?? Promise.resolve()
    },
  }
}

/** Same for OTLP log records (different path than traces — often same host, separate POST). */
export function wrapLogRecordExporterWithOtlpDiag(
  inner: LogRecordExporter,
  kind: string,
  target: string,
  enabled: boolean,
  timeoutMillis: number,
): LogRecordExporter {
  if (!enabled) return inner
  return {
    export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
      const started = Date.now()
      diag.info(`[veritly] OTLP ${kind} export start`, {
        target,
        itemCount: logs.length,
        timeoutMillis,
        runtime: process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`,
      })
      inner.export(logs, (result) => {
        logExportResult(kind, target, started, result, timeoutMillis)
        resultCallback(result)
      })
    },
    shutdown() {
      return inner.shutdown()
    },
  }
}
