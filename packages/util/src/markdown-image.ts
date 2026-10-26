import { getDirectory, getFilename } from "./path.js"

/** Returns the file path a Markdown image source names, or undefined for web, data, and invalid sources. */
export function localImagePath(source: string) {
  // Marked percent-encodes image sources, so `C:\tmp\chart.png` arrives as `C:%5Ctmp%5Cchart.png`.
  const value = source.trim().replace(/\\|%5c/gi, "/")

  if (!value || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) return

  if (/^file:/i.test(value)) {
    if (!URL.canParse(value)) return
    const url = new URL(value)

    if (url.hostname && url.hostname !== "localhost") return

    return decodePath(url.pathname.replace(/^\/([a-z]:\/)/i, "$1"))
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:\//i.test(value)) return

  return decodePath(value)
}

/**
 * Builds the file read request for a local image path. Relative paths resolve against the session
 * directory; absolute paths are scoped to their own parent so images outside the project stay readable.
 */
export function imageReadRequest(directory: string, path: string) {
  if (/^[a-z]:\//i.test(path) || path.startsWith("/"))
    return { path: getFilename(path), location: { directory: getDirectory(path) } }
  return { path, location: { directory } }
}

function decodePath(value: string) {
  try {
    const path = decodeURIComponent(value)

    if (/[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//") || path.startsWith("\\\\")) return

    return path
  } catch {
    return
  }
}
