import { trace } from "@opentelemetry/api"
import posthog from "posthog-js"

let inited = false

/** Hex trace id for correlation with server OTLP (no PII). Set once `initBrowserOtel` runs inside `initPosthog`. */
export function activeTraceContextProps(): { trace_id?: string; span_id?: string } {
  const sc = trace.getActiveSpan()?.spanContext()
  if (!sc?.traceId) return {}
  return { trace_id: sc.traceId, span_id: sc.spanId }
}

function browserSurfaceProps(): Record<string, string> {
  if (typeof window === "undefined") return {}
  return {
    browser_host: window.location.host,
    browser_origin: window.location.origin,
  }
}

export function initPosthog(): void {
  if (typeof window === "undefined" || inited) return
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY?.trim()
  const hostRaw = import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com"
  const api_host = hostRaw.replace(/\/+$/, "")
  if (!key) {
    if (import.meta.env.DEV) {
      console.warn(
        "[veritly] PostHog off: set VITE_PUBLIC_POSTHOG_KEY in .env.development and restart Vite (env is baked at dev-server start).",
      )
    }
    return
  }

  posthog.init(key, {
    api_host,
    /** Do not drop events when UA is classified as bot (Cursor/embedded previews often match). */
    opt_out_useragent_filter: true,
    /** Verbose PostHog client logs in dev (console) — see failed requests / batching. */
    debug: import.meta.env.DEV,
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    autocapture: false,
    persistence: "localStorage+cookie",
  })
  inited = true
  if (import.meta.env.DEV) {
    posthog.capture("veritly_posthog_smoke", { source: "vite_dev" })
  }
}

export function captureVeritly(
  event: string,
  props?: Record<string, unknown>,
): void {
  if (!inited) return
  const merged = { ...browserSurfaceProps(), ...activeTraceContextProps(), ...props }
  posthog.capture(event, merged)
}

export function identifyVeritly(distinctId: string, props?: Record<string, string>): void {
  if (!inited) return
  posthog.identify(distinctId, props)
}

export function resetPosthog(): void {
  if (!inited) return
  posthog.reset()
}

export { posthog }
