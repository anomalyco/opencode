// Only same-origin page paths may round-trip through the login flow. The path is
// appended to the OpenAuth callback URL, so anything that could change its origin
// (`//host`, backslashes, schemes) or its query/fragment is rejected.
export function continuePath(value: string | null | undefined) {
  if (!value) return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  if (/[\\?#\s]/.test(value)) return undefined
  if (value === "/auth" || value.startsWith("/auth/")) return undefined
  return value
}

// Absolute so `@solidjs/router` performs a full navigation instead of a client-side
// route change: `/auth/authorize` is a server-only API route, and navigating to it
// in the SPA renders the 404 page.
export function loginUrl(request: Request) {
  const url = new URL(request.url)
  const login = new URL("/auth/authorize", url.origin)
  const page = continuePath(pagePath(request, url))
  if (page) login.searchParams.set("continue", page)
  return login.toString()
}

// Server function calls are POSTs to `/_server`; the page they came from is only
// available through the referer, which the middleware keeps same-origin.
function pagePath(request: Request, url: URL) {
  if (url.pathname !== "/_server") return url.pathname
  const referer = request.headers.get("referer")
  if (!referer || !URL.canParse(referer)) return undefined
  const source = new URL(referer)
  if (source.origin !== url.origin) return undefined
  return source.pathname
}
