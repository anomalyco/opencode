/** Liveness/readiness only — no session or presign on these paths. */
export function isUniverCompatPublicPath(path: string) {
  return path === "/healthz" || path === "/health" || path === "/livez" || path === "/readyz"
}
