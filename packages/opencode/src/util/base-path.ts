/**
 * Normalizes a base path to ensure consistent format:
 * - Returns empty string for root path or undefined
 * - Ensures leading slash
 * - Removes trailing slashes
 */
export function normalizeBasePath(path?: string): string {
  if (!path || path === "/") return ""

  // Ensure leading slash, remove trailing slashes
  let normalized = path.startsWith("/") ? path : `/${path}`
  normalized = normalized.replace(/\/+$/, "")

  return normalized
}

/**
 * Joins a base path with additional path segments.
 * Handles normalization of the base path and proper joining of segments.
 */
export function joinPath(basePath: string, ...segments: string[]): string {
  const base = normalizeBasePath(basePath)
  const path = segments.join("/").replace(/\/+/g, "/")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}
