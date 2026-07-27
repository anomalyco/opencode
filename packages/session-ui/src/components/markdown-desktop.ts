/** True when markdown is rendered inside the OpenCode desktop Electron shell. */
export function isDesktopRenderer() {
  if (typeof window === "undefined") return false
  if (window.location.protocol === "oc:") return true
  return typeof (window as Window & { api?: { openPath?: unknown } }).api?.openPath === "function"
}

/** DOMPurify default plus `file:` — only enable on desktop; browsers block file: anyway. */
export const desktopAllowedUriRegexp =
  /^(?:(?:(?:f|ht)tps?|file|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

function stripLineColumn(path: string) {
  // `path:line` / `path:line:col` — keep Windows drive letters (`C:...`)
  return path.replace(/:(\d+)(:\d+)?$/, (match, _line, _col, offset, full) => {
    const before = full.slice(0, offset)
    if (!before || /^[a-zA-Z]$/.test(before)) return match
    return ""
  })
}

function toFileHref(path: string) {
  if (path.startsWith("/")) return `file://${encodeURI(path).replace(/#/g, "%23")}`
  return `file:///${encodeURI(path).replace(/#/g, "%23")}`
}

/** Build a file: href from bare absolute path text, or return undefined. */
export function absolutePathHref(text: string): string | undefined {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!href || /\s/.test(href)) return

  // Already a file URL
  if (/^file:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      let path = decodeURIComponent(url.pathname)
      if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
      path = stripLineColumn(path)
      if (!path || path === "/") return
      return toFileHref(path)
    } catch {
      return
    }
  }

  // Unix absolute
  if (href.startsWith("/") && href.length > 1) {
    const path = stripLineColumn(href)
    if (path === "/") return
    return toFileHref(path)
  }

  // Windows absolute
  if (/^[a-zA-Z]:[\\/]/.test(href)) {
    const path = stripLineColumn(href.replace(/\\/g, "/"))
    return toFileHref(path)
  }
}
