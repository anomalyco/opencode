export type PathKey = string & { _brand: "PathKey" }

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

export const pathKey = (path: string) => {
  const isWin = isWindowsPath(path)
  const value = isWin ? path.replaceAll("\\", "/") : path
  const trimmed = trimTrailingSlashes(value)
  const normalized = isWin ? trimmed.toLowerCase() : trimmed
  if (!normalized && value.startsWith("/")) return "/" as PathKey
  if (isDrive(normalized)) return `${normalized}/` as PathKey
  return normalized as PathKey
}

export const isSubpath = (candidate: string, parent: string) => {
  const child = pathKey(candidate)
  const base = pathKey(parent)
  if (child === base) return true
  const prefix = base.endsWith("/") ? base : `${base}/`
  return child.startsWith(prefix)
}
