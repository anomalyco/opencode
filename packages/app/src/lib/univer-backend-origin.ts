import { runtimeUniverBackendUrl } from "@/lib/runtime-config"

/**
 * Univer HTTP APIs (`/universer-api/*`, snapshots, exchange). Configure with `VITE_UNIVER_BACKEND_URL`.
 *
 * Set in `.env`:
 * - Local `@opencode-ai/univer-compat`: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8787`
 * - Docker compose nginx: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8000`
 * - univer-go-compat: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8099`
 */
export function univerBackendOrigin(): string {
  const v = runtimeUniverBackendUrl()
  if (v) return v.replace(/\/$/, "")
  return "http://127.0.0.1:8787"
}
