export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts[parts.length - 1] ?? ""
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const parts = trimmed.split(/[\/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(".")
  return parts[parts.length - 1]
}

export function getFilenameTruncated(path: string | undefined, maxLength: number = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const ext = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - ext.length - 1 // -1 for ellipsis
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + ext
}

export function truncateMiddle(text: string, maxLength: number = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1 // -1 for ellipsis
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}

const FILE_URI_PATTERN = /file:\/\/[^\s<>()`"']+/g
const PERCENT_RUN_PATTERN = /(?:%[0-9A-Fa-f]{2})+/g

function decodePercentRunIfUnicode(encoded: string) {
  try {
    const decoded = decodeURIComponent(encoded)
    return /[^\x00-\x7F]/.test(decoded) ? decoded : encoded
  } catch {
    return encoded
  }
}

export function decodeFileUriForDisplay(uri: string) {
  if (!uri.startsWith("file://")) return uri

  const queryIndex = uri.indexOf("?")
  const hashIndex = uri.indexOf("#")
  const boundary =
    queryIndex === -1
      ? hashIndex === -1
        ? uri.length
        : hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex)

  const base = uri.slice(0, boundary)
  const suffix = uri.slice(boundary)
  const path = base.slice("file://".length).replace(PERCENT_RUN_PATTERN, decodePercentRunIfUnicode)
  return `file://${path}${suffix}`
}

export function decodeFileUrisInText(text: string) {
  return text.replace(FILE_URI_PATTERN, decodeFileUriForDisplay)
}
