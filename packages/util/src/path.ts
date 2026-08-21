export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] ?? ""
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function getFilenameTruncated(path: string | undefined, maxLength = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const extension = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - extension.length - 1
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + extension
}

export function truncateMiddle(text: string, maxLength = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}
