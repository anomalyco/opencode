/** Liveness/readiness only — no session or presign on these paths. */
export function isUniverCompatPublicPath(path: string) {
  return path === "/livez" || path === "/readyz"
}
