import { runtimeUniverBackendUrl } from "@/lib/runtime-config"

/**
 * Univer HTTP APIs (`/universer-api/*`, snapshots, exchange). Configure with `VITE_UNIVER_BACKEND_URL`.
 *
 * Set in `.env`:
 * - Same-origin + Vite proxy (WorkOS cookie sent to app port): `VITE_UNIVER_BACKEND_URL=same-origin` and `DEV_UNIVER_COMPAT_URL=http://127.0.0.1:8787`
 * - Direct compat: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8787` (cookie will not cross port on localhost)
 * - Docker compose nginx: `VITE_UNIVER_BACKEND_URL=http://127.0.0.1:8000`
 */
export function univerBackendOrigin(): string {
  const v = runtimeUniverBackendUrl()
  if (!v) return "http://127.0.0.1:8787"
  const t = v.replace(/\/$/, "")
  if (t.toLowerCase() === "same-origin") return ""
  return t
}
