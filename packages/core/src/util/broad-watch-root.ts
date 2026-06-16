/** Normalize path segments for broad-root checks (no symlink resolution). */
export function normalizeWatchRootPath(directory: string): string {
  const trimmed = directory.trim()
  if (!trimmed || trimmed === "~") return trimmed || ""
  const posix = trimmed.replace(/\\/g, "/")
  const parts = posix.split("/").filter((part) => part && part !== ".")
  if (parts.length === 0) return "/"
  const stack: string[] = []
  for (const part of parts) {
    if (part === "..") {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return "/" + stack.join("/")
}

function looksLikeUserHome(normalized: string): boolean {
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 2) {
    return parts[0] === "home" || parts[0] === "Users"
  }
  if (parts.length === 3 && /^[a-zA-Z]:$/.test(parts[0])) {
    return parts[1] === "Users"
  }
  return false
}

function isDriveRoot(normalized: string): boolean {
  const parts = normalized.split("/").filter(Boolean)
  return parts.length === 1 && /^[a-zA-Z]:$/.test(parts[0])
}

/** Browser-safe check for directories that must not be file-watched or opened as projects. */
export function isBroadWatchRoot(directory: string, homeDir?: string): boolean {
  const trimmed = directory.trim()
  if (!trimmed) return true
  if (trimmed === "~") return true
  const normalized = normalizeWatchRootPath(directory)
  if (normalized === "/" || isDriveRoot(normalized)) return true
  if (homeDir && normalized === normalizeWatchRootPath(homeDir)) return true
  if (!homeDir && looksLikeUserHome(normalized)) return true
  return false
}
