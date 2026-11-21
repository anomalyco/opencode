export function sanitizeServerActionRequest(request: Request) {
  const requestUrl = new URL(request.url)
  if (requestUrl.pathname !== "/_server") return request

  const referer = request.headers.get("referer")
  if (referer && URL.canParse(referer) && new URL(referer).origin === requestUrl.origin) return request

  // Built from its parts: the dev server hands over its own Request class, which Node's
  // `new Request(request)` can't copy.
  const headers = new Headers(request.headers)
  headers.set("referer", requestUrl.origin)
  // Workers can hand over a GET or HEAD with a body, which a new Request refuses.
  const body = /^(GET|HEAD)$/i.test(request.method) ? null : request.body
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
    ...(body ? { duplex: "half" } : {}),
  } as RequestInit)
}
