// Simplified mime-types shim for browser
const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".xml": "text/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
  ".sh": "application/x-sh",
  ".py": "text/x-python",
  ".rs": "text/x-rust",
  ".go": "text/x-go",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
}

export function lookup(path: string): string | false {
  const ext = "." + path.split(".").pop()?.toLowerCase()
  return MIME_MAP[ext] || false
}

export function contentType(typeOrPath: string): string | false {
  const mime = lookup(typeOrPath)
  return mime ? `${mime}; charset=utf-8` : false
}

export function extension(type: string): string | false {
  for (const [ext, mime] of Object.entries(MIME_MAP)) {
    if (mime === type) return ext.slice(1)
  }
  return false
}

export default { lookup, contentType, extension }
