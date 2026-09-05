const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "connect-src * data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ")

export function addDocumentHeaders(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set("Content-Security-Policy", contentSecurityPolicy)
  headers.set("Document-Policy", "include-js-call-stacks-in-crash-reports")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
