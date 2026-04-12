import { trace } from "@opentelemetry/api"
import type { ServerConnection } from "@/context/server"
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

function authHeadersForServer(http: ServerConnection.HttpBase): Headers {
  const h = new Headers()
  if (http.password) {
    h.set("Authorization", `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`)
  }
  return h
}

/**
 * After the OpenCode server is reachable, merges Railway system IDs into PostHog super-properties
 * (`posthog.register`) so every capture is tagged with instance (replica, service, public domain, …).
 * Local dev returns `{}` from the API — you still get `browser_host` on each event.
 */
export async function registerPosthogDeploymentFromOpenCodeServer(http: ServerConnection.HttpBase): Promise<void> {
  if (!inited || typeof window === "undefined") return
  const base = http.url.replace(/\/$/, "")
  try {
    const res = await fetch(`${base}/global/veritly-deployment`, { headers: authHeadersForServer(http) })
    if (!res.ok) return
    const data = (await res.json()) as Record<string, unknown>
    const registerProps: Record<string, string> = {}
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.length > 0) registerProps[k] = v
    }
    if (Object.keys(registerProps).length > 0) posthog.register(registerProps)
  } catch {
    /* offline or local */
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
        "[veritly] PostHog off: set VITE_PUBLIC_POSTHOG_KEY in packages/app/.env and restart Vite (env is baked at dev-server start).",
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
