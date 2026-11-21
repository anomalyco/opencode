/** The path a build is served under, such as `/opencode`, without a trailing slash; empty at the root. */
export const basePath = normalizeBasePath(import.meta.env.BASE_URL)

export function normalizeBasePath(base: string | undefined) {
  const trimmed = (base ?? "").replace(/^\/+|\/+$/g, "")

  return trimmed ? `/${trimmed}` : ""
}

/** The browser path for an app path, such as `/opencode/new-session` for `/new-session`. */
export function withBasePath(path: string, base = basePath) {
  if (!base) return path

  return path === "/" ? `${base}/` : `${base}${path}`
}

/** The app path for a browser path, or the path itself when it lies outside the base. */
export function stripBasePath(path: string, base = basePath) {
  if (!base || !path.startsWith(base)) return path

  const rest = path.slice(base.length)

  if (rest.startsWith("/")) return rest

  if (rest === "" || rest.startsWith("?") || rest.startsWith("#")) return `/${rest}`

  return path
}
