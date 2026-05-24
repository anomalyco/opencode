export type PathKey = string & { _brand: "PathKey" }

const isDrive = (value: string) => {
  if (value.length !== 2) return false
  const code = value.charCodeAt(0)
  return value[1] === ":" && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
}

const isWindowsPath = (value: string) => value[1] === ":" || value.startsWith("\\\\")

export const pathKey = (path: string) => {
  let value = isWindowsPath(path) ? path.replaceAll("\\", "/") : path
  if (/^\/+$/.test(value)) return "/" as PathKey
  if (isDrive(value)) return `${value}/` as PathKey
  const trimmed = value.replace(/\/+$/, "")
  if (!trimmed) return "/" as PathKey
  return trimmed as PathKey
}
