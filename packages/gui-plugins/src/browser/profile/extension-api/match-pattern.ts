/** The schemes `<all_urls>` covers, and the ones a `*` scheme stands for. */
const ALL_URLS = ["http:", "https:", "ws:", "wss:", "file:", "ftp:"]

const ANY_SCHEME = ["http:", "https:", "ws:", "wss:"]

/**
 * A match pattern as Chrome reads one: `<all_urls>`, or `scheme://host/path` with `*` for any scheme of http, https,
 * ws and wss, `*` or `*.` for any host or subdomain, an optional port, and `*` anywhere in the path. Undefined for
 * anything else, which matches nothing.
 */
function parsePattern(pattern: string) {
  if (pattern === "<all_urls>") return { schemes: ALL_URLS, host: "*", path: "/*" }
  const parts = /^(\*|https?|wss?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern)

  if (!parts) return undefined
  const [, scheme = "", host = "", path = ""] = parts

  return { schemes: scheme === "*" ? ANY_SCHEME : [`${scheme}:`], host, path }
}

/** Whether a URL is inside one of an extension's host permissions; see `parsePattern`. */
export function matchesHost(patterns: readonly string[], input: string) {
  if (!URL.canParse(input)) return false
  const url = new URL(input)

  return patterns.some((pattern) => {
    const parsed = parsePattern(pattern)

    return (
      !!parsed &&
      parsed.schemes.includes(url.protocol) &&
      hostCovers(parsed.host, parsed.host.includes(":") ? url.host : url.hostname) &&
      globMatch(parsed.path, url.pathname + url.search)
    )
  })
}

/**
 * Whether the granted pattern covers every URL the requested one does, as `chrome.permissions.contains` asks: its
 * schemes include the requested ones, its host covers the requested host (wildcards included) and its path glob
 * matches the requested path.
 */
export function coversPattern(granted: string, requested: string) {
  const outer = parsePattern(granted)
  const inner = parsePattern(requested)

  if (!outer || !inner) return false

  return (
    inner.schemes.every((scheme) => outer.schemes.includes(scheme)) &&
    hostCovers(outer.host, inner.host) &&
    globMatch(outer.path, inner.path)
  )
}

/** Whether a pattern's host covers `host`, which may itself be a pattern's (`*`, `*.example.com`). */
function hostCovers(pattern: string, host: string) {
  if (pattern === "*") return true

  if (!pattern.startsWith("*.")) return pattern === host
  const domain = pattern.slice(2)
  const bare = host.startsWith("*.") ? host.slice(2) : host

  return bare === domain || bare.endsWith(`.${domain}`)
}

/**
 * Whether `text` matches `pattern`, where `*` stands for any run of characters and everything else for itself. One
 * pass that returns to the last `*` on a mismatch, so its time grows with the lengths multiplied, never exponentially,
 * whatever pattern an extension sends.
 */
export function globMatch(pattern: string, text: string) {
  const at = { pattern: 0, text: 0, star: -1, resume: 0 }

  while (at.text < text.length) {
    const expected = pattern[at.pattern]

    if (expected !== undefined && expected !== "*" && expected === text[at.text]) {
      at.pattern++
      at.text++
      continue
    }

    if (expected === "*") {
      at.star = at.pattern++
      at.resume = at.text
      continue
    }

    if (at.star < 0) return false
    at.pattern = at.star + 1
    at.text = ++at.resume
  }

  while (pattern[at.pattern] === "*") at.pattern++

  return at.pattern === pattern.length
}
