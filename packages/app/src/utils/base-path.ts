function normalizeBasePath(input?: string | null) {
  const value = input?.trim() ?? ""
  if (!value || value === "/") return ""
  const next = value.startsWith("/") ? value : `/${value}`
  return next.replace(/\/+$/, "")
}

export function runtimeBasePath(doc = document) {
  return normalizeBasePath(doc.querySelector('meta[name="opencode-base-path"]')?.getAttribute("content"))
}

export function currentServerUrl(location: Pick<Location, "origin"> | URL = window.location, doc = document) {
  return `${location.origin}${runtimeBasePath(doc)}`.replace(/\/+$/, "")
}

export function stripBrowserBasePath(pathname: string, basePath = runtimeBasePath()) {
  if (!basePath) return pathname || "/"
  if (pathname === basePath) return "/"
  if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length) || "/"
  return pathname || "/"
}
