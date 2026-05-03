/// <reference types="vite/client" />

declare module "*.py?raw" {
  const source: string
  export default source
}

interface ImportMetaEnv {
  /** Hosted API origin for the main OpenCode HTTP API. */
  readonly VITE_OPENCODE_SERVER_URL?: string
  /**
   * Single backend origin: `/universer-api/*` + `/v1/files/*`.
   * Docker: `http://127.0.0.1:8000` — go-compat: `http://127.0.0.1:8099`
   */
  readonly VITE_UNIVER_BACKEND_URL?: string
  /** Univer Pro `license.txt` body (same string as backend `configs/license.txt`). */
  readonly VITE_UNIVER_LICENSE?: string
  /** Optional project namespace header for hosted API lookups. */
  readonly VITE_VERITLY_PROJECT_ID?: string
  /** Optional local WebSocket relay used by the Univer SDK bridge. */
  readonly VITE_UNIVER_SDK_WS?: string
  /** PostHog project API key (public, safe in client bundle). */
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  /** PostHog API host (`https://eu.i.posthog.com` default in code when unset). */
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
  /** Axiom API token (`xaat_…`) for browser OTLP (optional; same risk model as `phc_`). */
  readonly VITE_PUBLIC_AXIOM_TOKEN?: string
  /** Axiom dataset name for `X-Axiom-Dataset` on OTLP traces. */
  readonly VITE_PUBLIC_AXIOM_DATASET?: string
  /** Axiom ingest origin (default `https://api.axiom.co`). */
  readonly VITE_PUBLIC_AXIOM_URL?: string
  /** Axiom browser OTLP: force same-origin proxy in prod preview. */
  readonly VITE_PUBLIC_AXIOM_OTLP_VIA_PROXY?: string
  /** Maps to `globalThis.OTEL_LOG_LEVEL` for `@opentelemetry/core` `getEnv()` (e.g. `debug`, `info`). */
  readonly VITE_PUBLIC_OTEL_LOG_LEVEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
