import { runtimeUniverBackendUrl } from "@/lib/runtime-config"

/**
 * One origin for both Univer HTTP APIs (`/universer-api/*`) and Veritly office APIs (`/v1/files/*`).
 *
 * Set in `.env`:
 * - Docker compose nginx: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8000`
 * - univer-go-compat:      `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8099`
 */
export function univerBackendOrigin(): string {
  const v = runtimeUniverBackendUrl()
  if (v) return v.replace(/\/$/, "")
  return "http://127.0.0.1:8000"
}
