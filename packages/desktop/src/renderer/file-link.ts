/** Convert a file: URL (or absolute path href) into a filesystem path. */
export function pathFromFileHref(href: string): string | undefined {
  const value = href.trim()
  if (!value) return

  if (value.startsWith("/") && !value.startsWith("//")) {
    return stripLocation(value)
  }

  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return stripLocation(value.replace(/\\/g, "/"))
  }

  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "file:") return

  let path = decodeURIComponent(url.pathname)
  // Windows file URLs are `/C:/...`
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
  // UNC paths: file://server/share → pathname `/share`, host is server
  if (url.hostname && url.hostname !== "localhost") {
    path = `//${url.hostname}${path}`
  }
  return stripLocation(path) || undefined
}

function stripLocation(path: string) {
  // Support `path:line` and `path:line:col` suffixes common in agent output.
  // Keep Windows drive letters (`C:...`).
  return path.replace(/:(\d+)(:\d+)?$/, (match, _line, _col, offset, full) => {
    const before = full.slice(0, offset)
    if (!before || /^[a-zA-Z]$/.test(before)) return match
    return ""
  })
}

export function isFileHref(href: string) {
  return pathFromFileHref(href) !== undefined && (/^file:/i.test(href.trim()) || href.trim().startsWith("/") || /^[a-zA-Z]:[\\/]/.test(href.trim()))
}
