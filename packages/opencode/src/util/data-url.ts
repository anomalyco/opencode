/**
 * Decodes a data URL to extract its content.
 *
 * Handles both base64 encoded and URL-encoded data URLs.
 * Returns the decoded string content.
 *
 * @param url The data URL to decode (e.g., "data:text/plain;base64,...")
 * @returns The decoded content as a string
 */
export function decodeDataUrl(url: string) {
  const idx = url.indexOf(",")
  if (idx === -1) return ""

  const head = url.slice(0, idx)
  const body = url.slice(idx + 1)
  if (head.includes(";base64")) return Buffer.from(body, "base64").toString("utf8")
  return decodeURIComponent(body)
}
