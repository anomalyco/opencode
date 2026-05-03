import { diag, DiagConsoleLogger, trace } from "@opentelemetry/api"
import { getEnv } from "@opentelemetry/core"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Resource } from "@opentelemetry/resources"
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web"

let inited = false

const BROWSER_OTEL_GLOBAL_KEY = "__veritlyBrowserOtelInited" as const

const DEFAULT_AXIOM_ORIGIN = "https://api.axiom.co"

/**
 * Browser OTLP → **Axiom** only (`VITE_PUBLIC_AXIOM_TOKEN` + `VITE_PUBLIC_AXIOM_DATASET`).
 * Put the same values as `AXIOM_*` in `.env.development` / `.env.production` — Vite does not expose non-VITE_ vars to the bundle.
 *
 * Spans: dev smoke (`veritly.debug.smoke`), or call `browserTracer().startActiveSpan(...)` from app code.
 * Server OTLP: `initVeritlyTracer` in opencode / edge / usip / sdk-relay (needs `OTEL_*` + `AXIOM_*` in env).
 *
 * Dev uses same-origin Vite proxy (`/__veritly/axiom-otlp-traces` → `/v1/traces`) to avoid CORS.
 *
 * **Diagnostic logging:** Uses OpenTelemetry’s standard `OTEL_LOG_LEVEL` (same as the JS SDK): `none`,
 * `error`, `warn`, `info`, `debug`, `verbose`, `all`. In the browser, `@opentelemetry/core` reads that
 * from `globalThis`; this app copies `VITE_PUBLIC_OTEL_LOG_LEVEL` onto `globalThis` before `getEnv()`, or
 * you can set `window.OTEL_LOG_LEVEL = "debug"` yourself before the app loads.
 */
export function initBrowserOtel(): void {
  if (typeof window === "undefined" || inited) return
  if ((globalThis as unknown as Record<string, boolean>)[BROWSER_OTEL_GLOBAL_KEY]) return

  const viteOtel = import.meta.env.VITE_PUBLIC_OTEL_LOG_LEVEL?.trim()
  if (viteOtel) {
    ;(globalThis as unknown as { OTEL_LOG_LEVEL?: string }).OTEL_LOG_LEVEL = viteOtel
  }

  const { OTEL_LOG_LEVEL } = getEnv()
  diag.setLogger(new DiagConsoleLogger(), OTEL_LOG_LEVEL)

  const axiomToken = import.meta.env.VITE_PUBLIC_AXIOM_TOKEN?.trim()
  const axiomDataset = import.meta.env.VITE_PUBLIC_AXIOM_DATASET?.trim()
  const axiomBase = (import.meta.env.VITE_PUBLIC_AXIOM_URL || DEFAULT_AXIOM_ORIGIN).replace(/\/+$/, "")

  if (!axiomToken || !axiomDataset) return

  const viaProxy = import.meta.env.DEV || import.meta.env.VITE_PUBLIC_AXIOM_OTLP_VIA_PROXY === "true"
  const url = viaProxy ? `${window.location.origin}/__veritly/axiom-otlp-traces` : `${axiomBase}/v1/traces`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${axiomToken}`,
    "X-Axiom-Dataset": axiomDataset,
  }

  const exporter = new OTLPTraceExporter({ url, headers })

  const resource = new Resource({
    "service.name": "veritly-app",
    "deployment.environment": import.meta.env.PROD ? "production" : import.meta.env.MODE || "development",
  })

  const processor = import.meta.env.DEV ? new SimpleSpanProcessor(exporter) : new SimpleSpanProcessor(exporter)

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [processor],
  })

  /** `register()` already calls `propagation.setGlobalPropagator` (W3C trace + baggage from env). Do not set it again — duplicate throws. */
  provider.register()
  inited = true
  ;(globalThis as unknown as Record<string, boolean>)[BROWSER_OTEL_GLOBAL_KEY] = true

  if (import.meta.env.DEV) {
    trace.getTracer("veritly-app").startActiveSpan("veritly.debug.smoke", (span) => {
      span.setAttribute("veritly.debug", true)
      span.end()
    })
  }
}

export function browserTracer(name = "veritly-app") {
  return trace.getTracer(name)
}
