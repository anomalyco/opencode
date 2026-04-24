const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mkv",
  ".mov",
  ".wasm",
  ".class",
  ".jar",
  ".pyc",
])

export function isBinary(path: string): boolean {
  const lower = path.toLowerCase()
  for (const ext of BINARY_EXTS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

export const MAX_EDITABLE_BYTES = 10 * 1024 * 1024

export function tooLarge(contents: string): boolean {
  // contents 是 JS string (UTF-16 units);用 charCount 估 UTF-8 字节数的上界
  return contents.length > MAX_EDITABLE_BYTES
}
