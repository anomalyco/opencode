export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return trimmed.slice(index + 1)
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

const isDrive = (value: string) => {
  if (value.length !== 2) return false
  const code = value.charCodeAt(0)
  return value[1] === ":" && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
}

const trimTrailingSlashes = (value: string) => {
  for (let i = value.length - 1; i >= 0; i--) {
    if (value[i] !== "/") return value.slice(0, i + 1)
  }
  return ""
}

const isWindowsPath = (value: string) => value[1] === ":" || value.startsWith("\\\\")

/** A comparable form of a directory path: forward slashes for Windows paths, no trailing slash except on roots. */
export function comparablePath(path: string) {
  const value = isWindowsPath(path) ? path.replaceAll("\\", "/") : path
  const trimmed = trimTrailingSlashes(value)
  if (!trimmed && value.startsWith("/")) return "/"
  if (isDrive(trimmed)) return `${trimmed}/`
  return trimmed
}

/** `child` is `parent` or inside it. Windows drive and UNC paths compare case-insensitively. */
export function containsDirectory(parent: string, child: string) {
  const normalize = (value: string) => {
    const key = comparablePath(value)
    return /^[a-z]:\//i.test(key) || key.startsWith("//") ? key.toLowerCase() : key
  }
  const root = normalize(parent)
  const target = normalize(child)
  return target === root || target.startsWith(root.endsWith("/") ? root : `${root}/`)
}

export function sameDirectory(a: string, b: string) {
  return containsDirectory(a, b) && containsDirectory(b, a)
}

export function encodeFilePath(filepath: string): string {
  // Normalize Windows paths: convert backslashes to forward slashes
  const normalized = filepath.replace(/\\/g, "/")

  // Handle Windows absolute paths (D:/path -> /D:/path for proper file:// URLs)
  const rooted = /^[A-Za-z]:/.test(normalized) ? "/" + normalized : normalized

  // Encode each path segment (preserving forward slashes as path separators)
  // Keep the colon in Windows drive letters (`/C:/...`) so downstream file URL parsers
  // can reliably detect drives.
  return rooted
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment
      return encodeURIComponent(segment)
    })
    .join("/")
}
