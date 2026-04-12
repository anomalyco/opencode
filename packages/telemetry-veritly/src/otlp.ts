function parseOtlpHeaders(): Record<string, string> | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim()
  if (!raw) return undefined
  const out: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const i = part.indexOf("=")
    if (i === -1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

function isPosthogIngestHost(url: string): boolean {
  try {
    return /\.(i\.)?posthog\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Standard OTLP HTTP: `…/v1/traces`. PostHog Cloud: `…/i/v1/traces`. Axiom: `https://api.axiom.co/v1/traces`. */
export function resolveOtlpTracesUrl(): string | undefined {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  if (explicit) return explicit
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!base) return undefined
  const normalized = base.replace(/\/$/, "")
  if (normalized.endsWith("/v1/traces") || normalized.endsWith("/i/v1/traces")) return normalized
  if (isPosthogIngestHost(normalized)) return `${normalized}/i/v1/traces`
  return `${normalized}/v1/traces`
}

/** OTLP logs: PostHog `…/i/v1/logs`; Axiom and most collectors `…/v1/logs`. */
export function resolveOtlpLogsUrl(): string | undefined {
  const explicit = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim()
  if (explicit) return explicit
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (!base) return undefined
  const normalized = base.replace(/\/$/, "")
  if (normalized.endsWith("/v1/logs") || normalized.endsWith("/i/v1/logs")) return normalized
  if (isPosthogIngestHost(normalized)) return `${normalized}/i/v1/logs`
  return `${normalized}/v1/logs`
}

/** OTLP HTTP client timeout (ms). Spec: `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` / `LOGS` override `OTEL_EXPORTER_OTLP_TIMEOUT`; SDK default 10000. */
function parseOtlpTimeoutMillis(signal: "traces" | "logs"): number {
  const specific =
    signal === "traces"
      ? process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT?.trim()
      : process.env.OTEL_EXPORTER_OTLP_LOGS_TIMEOUT?.trim()
  const general = process.env.OTEL_EXPORTER_OTLP_TIMEOUT?.trim()
  const raw = specific ?? general
  if (!raw) return 10_000
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 10_000
}

/** Safe target for diag (no query string, no auth). */
export function sanitizeOtlpUrlForDiag(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return "(invalid OTLP url)"
  }
}

/** Merged OTLP HTTP headers (OTEL_* + Axiom). Call at export time so env loaded after module init still applies (Bun fetch exporter). */
export function mergeOtlpHeaders(): Record<string, string> | undefined {
  const out: Record<string, string> = { ...(parseOtlpHeaders() ?? {}) }
  const token =
    process.env.AXIOM_TOKEN?.trim() ||
    process.env.AXIOM_API_TOKEN?.trim() ||
    process.env.OTEL_EXPORTER_OTLP_AXIOM_TOKEN?.trim()
  const dataset = process.env.AXIOM_DATASET?.trim() || process.env.OTEL_EXPORTER_OTLP_AXIOM_DATASET?.trim()
  if (token && !out.Authorization && !out.authorization) {
    out.Authorization = `Bearer ${token}`
  }
  if (dataset && !out["X-Axiom-Dataset"]) {
    out["X-Axiom-Dataset"] = dataset
  }
  return Object.keys(out).length ? out : undefined
}

export type OtlpHttpExporterConfig = {
  url: string
  headers?: Record<string, string>
  timeoutMillis: number
}

export function otlpTraceExporterOptions(): OtlpHttpExporterConfig | undefined {
  const url = resolveOtlpTracesUrl()
  if (!url) return undefined
  const headers = mergeOtlpHeaders()
  return { url, headers, timeoutMillis: parseOtlpTimeoutMillis("traces") }
}

export function otlpLogsExporterOptions(): OtlpHttpExporterConfig | undefined {
  const url = resolveOtlpLogsUrl()
  if (!url) return undefined
  const headers = mergeOtlpHeaders()
  return { url, headers, timeoutMillis: parseOtlpTimeoutMillis("logs") }
}
