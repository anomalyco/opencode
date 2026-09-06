export const documentPolicyHeader = "Document-Policy"
export const jsCallStacksDocumentPolicy = "include-js-call-stacks-in-crash-reports"

// The renderer lives at oc://renderer, so every server it talks to is cross-origin. Servers that
// send no CORS headers get permissive ones here so the renderer can still reach them.
//
// A server's own `Access-Control-Allow-Headers` is kept as-is. Chromium reuses a cached preflight
// only when that header names `authorization` explicitly (`*` never covers it), so overwriting the
// server's exact list with `*` forced a fresh OPTIONS round trip in front of every API call.
export function addRendererHeaders(headers: object, options: { document: boolean }) {
  upsertHeader(headers, "Access-Control-Allow-Origin", ["*"])
  if (!hasHeader(headers, "Access-Control-Allow-Headers")) {
    upsertHeader(headers, "Access-Control-Allow-Headers", ["*, authorization"])
  }
  if (!hasHeader(headers, "Access-Control-Max-Age")) {
    // Chromium caps preflight cache lifetime at two hours; without the header it caches for 5s.
    upsertHeader(headers, "Access-Control-Max-Age", ["7200"])
  }
  if (options.document) upsertHeader(headers, documentPolicyHeader, [jsCallStacksDocumentPolicy])
}

export function hasHeader(headers: object, key: string) {
  return Object.keys(headers).some((header) => header.toLowerCase() === key.toLowerCase())
}

export function upsertHeader(headers: object, key: string, value: string | string[]) {
  const current = Object.keys(headers).find((header) => header.toLowerCase() === key.toLowerCase())
  Reflect.set(headers, current ?? key, value)
}
