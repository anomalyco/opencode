/**
 * Whether a URL is inside one of an extension's host permissions, as Chrome's match patterns read them:
 * `<all_urls>`, and `scheme://host/path` with `*` for any scheme of http, https, ws and wss, `*.` for any subdomain
 * and `*` anywhere in the path. Anything else matches nothing.
 */
export function matchesHost(patterns: readonly string[], input: string) {
  if (!URL.canParse(input)) return false
  const url = new URL(input)

  return patterns.some((pattern) => matchesPattern(pattern, url))
}

function matchesPattern(pattern: string, url: URL) {
  if (pattern === "<all_urls>") return ["http:", "https:", "ws:", "wss:", "file:", "ftp:"].includes(url.protocol)
  const parts = /^(\*|https?|wss?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern)

  if (!parts) return false
  const [, scheme = "", host = "", path = ""] = parts
  const schemes = scheme === "*" ? ["http:", "https:", "ws:", "wss:"] : [`${scheme}:`]

  if (!schemes.includes(url.protocol)) return false

  if (host !== "*" && host !== url.hostname && !(host.startsWith("*.") && subdomain(url.hostname, host.slice(2))))
    return false

  return new RegExp(`^${path.split("*").map(escape).join(".*")}$`).test(url.pathname + url.search)
}

function subdomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
