import { context, diag, DiagConsoleLogger, propagation, trace } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { W3CTraceContextPropagator, getEnv } from "@opentelemetry/core"
import { createOtlpLogExporter, createOtlpTraceExporter, useFetchOtlpExporters } from "./otlp-exporters.js"
import { Resource } from "@opentelemetry/resources"
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs"
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import {
  isOtlpExportDebugEnabled,
  wrapLogRecordExporterWithOtlpDiag,
  wrapSpanExporterWithOtlpDiag,
} from "./otlp-export-diag.js"
import { otlpLogsExporterOptions, otlpTraceExporterOptions, sanitizeOtlpUrlForDiag } from "./otlp.js"
import { railwayOtelResourceAttributes } from "./railway.js"

export type InitVeritlyTracerOptions = {
  serviceName: string
  /** Use AsyncLocalStorage context (Node). Bun can omit. */
  useAsyncLocalStorage?: boolean
  /** Extra attributes on `veritly.otlp.bootstrap.ping` (process-specific config snapshot). */
  bootstrapAttributes?: Record<string, string | number | boolean>
}

let shutdownFn: (() => Promise<void>) | undefined

export function initVeritlyTracer(options: InitVeritlyTracerOptions): { shutdown: () => Promise<void> } {
  const existing = shutdownFn
  if (existing) {
    return { shutdown: existing }
  }

  const { OTEL_LOG_LEVEL } = getEnv()
  diag.setLogger(new DiagConsoleLogger(), OTEL_LOG_LEVEL)

  const otlp = otlpTraceExporterOptions()
  const otlpLogs = otlpLogsExporterOptions()
  const exportDiag = isOtlpExportDebugEnabled()
  if (otlp) {
    diag.info("[veritly] OTLP traces configured", {
      target: sanitizeOtlpUrlForDiag(otlp.url),
      timeoutMillis: otlp.timeoutMillis,
      exportHttpDiag: exportDiag,
      transport: useFetchOtlpExporters() ? "fetch" : "node-http",
    })
  }
  if (otlpLogs) {
    diag.info("[veritly] OTLP logs configured", {
      target: sanitizeOtlpUrlForDiag(otlpLogs.url),
      timeoutMillis: otlpLogs.timeoutMillis,
      exportHttpDiag: exportDiag,
      transport: useFetchOtlpExporters() ? "fetch" : "node-http",
    })
  }
  if (!otlp && !otlpLogs) {
    const noop = async () => {}
    shutdownFn = noop
    return { shutdown: noop }
  }

  if (options.useAsyncLocalStorage !== false && typeof process !== "undefined") {
    try {
      context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
    } catch {
      /* Bun or restricted env */
    }
  }
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())

  const env =
    process.env.DEPLOYMENT_ENVIRONMENT?.trim() ||
    process.env.RAILWAY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV ||
    "development"

  const resource = new Resource({
    "service.name": options.serviceName,
    "deployment.environment": env,
    ...railwayOtelResourceAttributes(),
  })

  let traceShutdown: () => Promise<void> = async () => {}
  let traceProvider: BasicTracerProvider | undefined
  if (otlp) {
    const exporter = wrapSpanExporterWithOtlpDiag(
      createOtlpTraceExporter(otlp),
      "traces",
      sanitizeOtlpUrlForDiag(otlp.url),
      exportDiag,
      otlp.timeoutMillis,
    )
    traceProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    trace.setGlobalTracerProvider(traceProvider)
    traceShutdown = () => traceProvider!.shutdown()
  }

  let logsShutdown: () => Promise<void> = async () => {}
  if (otlpLogs) {
    const logExporter = wrapLogRecordExporterWithOtlpDiag(
      createOtlpLogExporter(otlpLogs),
      "logs",
      sanitizeOtlpUrlForDiag(otlpLogs.url),
      exportDiag,
      otlpLogs.timeoutMillis,
    )
    const loggerProvider = new LoggerProvider({ resource })
    loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter))
    logs.setGlobalLoggerProvider(loggerProvider)
    logsShutdown = () => loggerProvider.shutdown()
  }

  // One OTLP span on boot (same exporter as prod). VERITLY_OTLP_BOOTSTRAP_SPAN=0 disables.
  const bootstrapOff = process.env.VERITLY_OTLP_BOOTSTRAP_SPAN?.trim() === "0"
  if (traceProvider && otlp && !bootstrapOff) {
    trace.getTracer("veritly-otlp-bootstrap").startActiveSpan("veritly.otlp.bootstrap.ping", (span) => {
      span.setAttribute("veritly.bootstrap", true)
      span.setAttribute("veritly.bootstrap.service", options.serviceName)
      span.setAttribute("veritly.otlp.traces_endpoint", sanitizeOtlpUrlForDiag(otlp.url))
      span.setAttribute("veritly.otlp.traces_timeout_ms", otlp.timeoutMillis)
      if (otlpLogs) {
        span.setAttribute("veritly.otlp.logs_endpoint", sanitizeOtlpUrlForDiag(otlpLogs.url))
        span.setAttribute("veritly.otlp.logs_timeout_ms", otlpLogs.timeoutMillis)
      }
      const extra = options.bootstrapAttributes
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          span.setAttribute(k, v)
        }
      }
      span.end()
    })
    void traceProvider.forceFlush().catch((err) => {
      diag.debug("veritly OTLP bootstrap forceFlush", err)
    })
  }

  const shutdown = async () => {
    await traceShutdown()
    await logsShutdown()
  }
  shutdownFn = shutdown
  return { shutdown }
}
