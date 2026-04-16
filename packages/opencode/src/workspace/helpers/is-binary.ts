/**
 * Pure binary-file detection. Two signals:
 *
 *   1. Extension is on a known-binary list (zip/tar/exe/etc).
 *   2. First ~4 KB of bytes contains a NUL, or > 30% non-printable
 *      characters.
 *
 * The caller passes the extension separately so this helper stays pure
 * (no path parsing, no fs). Workspace.Primitives.isBinary wires this to
 * `path.extname(p).toLowerCase()` + a single `readFile` call.
 */

const KNOWN_BINARY_EXT: ReadonlySet<string> = new Set<string>([
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

export function isBinaryBytes(ext: string, bytes: Uint8Array): boolean {
  if (KNOWN_BINARY_EXT.has(ext.toLowerCase())) return true
  if (bytes.length === 0) return false
  const sample = Math.min(4096, bytes.length)
  let nonPrintable = 0
  for (let i = 0; i < sample; i++) {
    const b = bytes[i]
    if (b === 0) return true
    // Accept \t (9), \n (10), \v (11), \f (12), \r (13), and 32..126 printable
    if (b < 9 || (b > 13 && b < 32)) nonPrintable++
  }
  return nonPrintable / sample > 0.3
}
