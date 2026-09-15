export function sanitizeServerActionRequest(request: Request) {
  const requestUrl = new URL(request.url)
  if (requestUrl.pathname !== "/_server") return request

  const referer = request.headers.get("referer")
  if (referer && URL.canParse(referer) && new URL(referer).origin === requestUrl.origin) return request

  const sanitized = new Request(request)
  sanitized.headers.set("referer", requestUrl.origin)
  return sanitized
}
