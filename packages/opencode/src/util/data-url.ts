export function decodeDataUrl(url: string) {
  const idx = url.indexOf(",")
  if (idx === -1) return ""

  const head = url.slice(0, idx)
  const body = url.slice(idx + 1)
  if (head.includes(";base64")) return Buffer.from(body, "base64").toString("utf8")
  // Non-base64 data URLs carry percent-encoded text (RFC 2397), but external
  // sources (MCP resources, plugins) can emit unescaped "%", which makes
  // decodeURIComponent throw; fall back to the raw body instead of crashing.
  try {
    return decodeURIComponent(body)
  } catch {
    return body
  }
}
