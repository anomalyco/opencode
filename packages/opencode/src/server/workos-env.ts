/** Evaluated on each use so `process.env` (and tests) can be set after modules load. */

function truthy(key: string): boolean {
  const v = process.env[key]?.toLowerCase()
  return v === "true" || v === "1"
}

/**
 * When true, the API uses WorkOS sealed-session cookies (normal Veritly web / hosted mode).
 * When false, the API does not enforce WorkOS (e.g. local `serve` with password or open dev).
 */
export function isOpencodeWorkosEnabled(): boolean {
  return truthy("OPENCODE_WORKOS_ENABLED")
}
