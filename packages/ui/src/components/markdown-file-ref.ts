export type FileRef = {
  path: string
  line?: number
}

function looksLikePath(path: string) {
  if (!path) return false
  if (path.startsWith("./") || path.startsWith("../") || path.startsWith("/")) return true
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true
  return path.includes("/") || path.includes("\\")
}

function normalizeProjectPath(path: string, directory: string) {
  if (!path) return path
  const file = path.replace(/\\/g, "/")
  const root = directory.replace(/\\/g, "/")
  if (/^\/[a-zA-Z]:\//.test(file)) return file.slice(1)
  if (file.startsWith(root + "/")) return file.slice(root.length + 1)
  if (file === root) return ""
  if (file.startsWith("./")) return file.slice(2)
  return file
}

export function parseCodeFileRef(text: string, directory: string): FileRef | undefined {
  let value = text.trim().replace(/[),.;!?]+$/, "")
  let lineFromUrlHash: number | undefined
  if (!value) return

  if (value.startsWith("file://")) {
    try {
      const url = new URL(value)
      value = decodeURIComponent(url.pathname)
      const match = url.hash.match(/^#L(\d+)$/)
      lineFromUrlHash = match ? Number(match[1]) : undefined
    } catch {
      return
    }
  }

  const hash = value.match(/#L(\d+)$/)
  const lineFromHash = hash ? Number(hash[1]) : undefined
  if (hash) value = value.slice(0, -hash[0].length)

  const line = value.match(/:(\d+)(?::\d+)?$/)
  const lineFromSuffix = line ? Number(line[1]) : undefined
  if (line) {
    const maybePath = value.slice(0, -line[0].length)
    if (looksLikePath(maybePath)) value = maybePath
  }

  if (!looksLikePath(value)) return
  const path = normalizeProjectPath(value, directory)
  if (!path) return
  return { path, line: lineFromUrlHash ?? lineFromHash ?? lineFromSuffix }
}
