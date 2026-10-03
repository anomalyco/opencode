import path from "path"

const extensions = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".class",
  ".jar",
  ".war",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".bin",
  ".dat",
  ".obj",
  ".o",
  ".a",
  ".lib",
  ".wasm",
  ".pyc",
  ".pyo",
])

export function isBinaryFile(filepath: string, bytes: Uint8Array) {
  if (extensions.has(path.extname(filepath).toLowerCase())) return true
  if (bytes.length === 0) return false

  let nonPrintableCount = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintableCount++
  }

  return nonPrintableCount / bytes.length > 0.3
}
