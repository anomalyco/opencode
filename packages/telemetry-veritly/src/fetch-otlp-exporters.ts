import { ExportResultCode, type ExportResult } from "@opentelemetry/core"
import { JsonLogsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer"
import type { LogRecordExporter } from "@opentelemetry/sdk-logs"
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs"
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"
import type { SpanExporter } from "@opentelemetry/sdk-trace-base"
import { mergeOtlpHeaders } from "./otlp.js"
import type { OtlpHttpExporterConfig } from "./otlp.js"

function headersForOtlpPost(config: OtlpHttpExporterConfig): Headers {
  const h = new Headers()
  h.set("Content-Type", "application/json")
  const merged = mergeOtlpHeaders() ?? {}
  const fromInit = config.headers ?? {}
  for (const [k, v] of Object.entries({ ...fromInit, ...merged })) {
    h.set(k, v)
  }
  return h
}

/**
 * Bun: Node `http(s).request` used by OTLP node-http often fails (~spurious close → "Request timed out").
 * Browser OTLP exporters hit CJS/ESM `OTLPExporterBase` interop under Bun (`Cannot call a class constructor … without |new|`).
 * Plain `fetch` + JSON OTLP avoids both. See oven-sh/bun#3775 and related OTel+Bun threads.
 */
export class FetchOtlpTraceExporter implements SpanExporter {
  constructor(private readonly config: OtlpHttpExporterConfig) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const serialized = JsonTraceSerializer.serializeRequest(spans)
    if (serialized == null) {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error("Nothing to send") })
      return
    }
    void this.post(serialized, resultCallback)
  }

  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}

  private async post(body: Uint8Array, resultCallback: (result: ExportResult) => void): Promise<void> {
    const headers = headersForOtlpPost(this.config)
    const controller = new AbortController()
    const kill = setTimeout(() => controller.abort(), this.config.timeoutMillis)
    try {
      const res = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: body as unknown as BodyInit,
        signal: controller.signal,
      })
      clearTimeout(kill)
      if (res.ok) {
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }
      const text = await res.text().catch(() => "")
      const hint401 =
        res.status === 401 && !mergeOtlpHeaders()?.Authorization
          ? " No Authorization header — ensure AXIOM_TOKEN (or OTEL_EXPORTER_OTLP_HEADERS) is in the process environment for this binary (e.g. bun --env-file=…/app/.env)."
          : ""
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error(
          `OTLP traces HTTP ${res.status}: ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}${hint401}`,
        ),
      })
    } catch (err) {
      clearTimeout(kill)
      resultCallback({
        code: ExportResultCode.FAILED,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }
  }
}

export class FetchOtlpLogExporter implements LogRecordExporter {
  constructor(private readonly config: OtlpHttpExporterConfig) {}

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    const serialized = JsonLogsSerializer.serializeRequest(logs)
    if (serialized == null) {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error("Nothing to send") })
      return
    }
    void this.post(serialized, resultCallback)
  }

  async shutdown(): Promise<void> {}

  private async post(body: Uint8Array, resultCallback: (result: ExportResult) => void): Promise<void> {
    const headers = headersForOtlpPost(this.config)
    const controller = new AbortController()
    const kill = setTimeout(() => controller.abort(), this.config.timeoutMillis)
    try {
      const res = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: body as unknown as BodyInit,
        signal: controller.signal,
      })
      clearTimeout(kill)
      if (res.ok) {
        resultCallback({ code: ExportResultCode.SUCCESS })
        return
      }
      const text = await res.text().catch(() => "")
      const hint401 =
        res.status === 401 && !mergeOtlpHeaders()?.Authorization
          ? " No Authorization header — ensure AXIOM_TOKEN (or OTEL_EXPORTER_OTLP_HEADERS) is in the process environment for this binary (e.g. bun --env-file=…/app/.env)."
          : ""
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error(
          `OTLP logs HTTP ${res.status}: ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}${hint401}`,
        ),
      })
    } catch (err) {
      clearTimeout(kill)
      resultCallback({
        code: ExportResultCode.FAILED,
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }
  }
}
