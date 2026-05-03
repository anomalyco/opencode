export function normalizeBasePath(input?: string) {
  const value = input?.trim() ?? ""
  if (!value || value === "/") return ""
  const next = value.startsWith("/") ? value : `/${value}`
  return next.replace(/\/+$/, "")
}

export function stripBasePath(pathname: string, basePath: string) {
  if (!basePath) return pathname || "/"
  if (pathname === basePath) return "/"
  if (pathname.startsWith(basePath + "/")) return pathname.slice(basePath.length) || "/"
  return pathname || "/"
}

export function rewriteRequestBasePath(request: Request, basePath: string) {
  if (!basePath) return request
  const url = new URL(request.url)
  const pathname = stripBasePath(url.pathname, basePath)
  if (pathname === url.pathname) return request
  url.pathname = pathname
  return new Request(url, request)
}

export * as ServerBasePath from "./base-path"
