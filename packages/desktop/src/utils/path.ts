import { useSync } from "@/context/sync"

export function getFilename(path: string) {
  if (!path) return ""
  const trimmed = path.replace(/[\/]+$/, "")
  const parts = trimmed.split("/")
  return parts[parts.length - 1] ?? ""
}

export function getDirectory(path: string) {
  const sync = useSync()
  const parts = path.split("/")
  const dir = parts.slice(0, parts.length - 1).join("/")
  return dir ? sync.sanitize(dir + "/") : ""
}

export function getFileExtension(path: string) {
  const parts = path.split(".")
  return parts[parts.length - 1]
}
