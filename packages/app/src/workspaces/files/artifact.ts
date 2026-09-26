import type { FileContent } from "@/runtime/server/types"

export type ArtifactKind =
  | "image"
  | "svg"
  | "audio"
  | "video"
  | "pdf"
  | "html"
  | "markdown"
  | "mermaid"
  | "table"
  | "font"
  | "text"

const mimes = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["svg", "image/svg+xml"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["opus", "audio/ogg"],
  ["weba", "audio/webm"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["ogv", "video/ogg"],
  ["mkv", "video/x-matroska"],
  ["pdf", "application/pdf"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["mdx", "text/markdown"],
  ["mmd", "text/vnd.mermaid"],
  ["mermaid", "text/vnd.mermaid"],
  ["csv", "text/csv"],
  ["tsv", "text/tab-separated-values"],
  ["ttf", "font/ttf"],
  ["otf", "font/otf"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
])

export function artifactExtension(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")
  if (index <= 0) return ""
  return name.slice(index + 1).toLowerCase()
}

export function artifactMime(path: string) {
  return mimes.get(artifactExtension(path))
}

export function artifactKind(path: string): ArtifactKind {
  const mime = artifactMime(path)
  if (!mime) return "text"
  if (mime === "image/svg+xml") return "svg"
  if (mime === "application/pdf") return "pdf"
  if (mime === "text/html") return "html"
  if (mime === "text/markdown") return "markdown"
  if (mime === "text/vnd.mermaid") return "mermaid"
  if (mime === "text/csv" || mime === "text/tab-separated-values") return "table"
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("font/")) return "font"
  return "video"
}

/** Kinds whose bytes are kept as base64 so media elements can play them without a text round trip. */
const binaryKinds = new Set<ArtifactKind>(["image", "audio", "video", "pdf", "font"])

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0)
}

export function bytesToBase64(bytes: Uint8Array) {
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
  }
  return btoa(parts.join(""))
}

/** Media above this stays a placeholder: base64 encoding on the main thread and the LRU budget both suffer. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

export function fileContentFromBytes(path: string, bytes: Uint8Array): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)
  if (binaryKinds.has(kind)) {
    if (bytes.length > MAX_MEDIA_BYTES) return { type: "binary", content: "", size: bytes.length }
    return { type: "binary", content: bytesToBase64(bytes), encoding: "base64", mimeType }
  }
  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "", size: bytes.length }
  return { type: "text", content: new TextDecoder().decode(bytes), mimeType }
}

/** Approximate on-disk size of loaded content. */
export function contentBytes(content: FileContent) {
  if (content.size !== undefined) return content.size
  if (content.encoding === "base64") {
    const padding = content.content.endsWith("==") ? 2 : content.content.endsWith("=") ? 1 : 0
    return Math.floor((content.content.length * 3) / 4) - padding
  }
  return new TextEncoder().encode(content.content).length
}

/**
 * Parse RFC 4180 style delimited text. Quoted fields may contain the delimiter, newlines, and
 * doubled quotes. Rows beyond `limit` are counted but not returned.
 */
export function parseDelimited(text: string, delimiter: string, limit = 1000) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let total = 0
  const endRow = () => {
    row.push(field)
    field = ""
    const blank = row.length === 1 && row[0] === ""
    if (!blank) {
      total++
      if (rows.length < limit) rows.push(row)
    }
    row = []
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char !== '"') {
        field += char
        continue
      }
      if (text[index + 1] === '"') {
        field += '"'
        index++
        continue
      }
      quoted = false
      continue
    }
    if (char === '"' && field === "") {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ""
      continue
    }
    if (char === "\r") continue
    if (char === "\n") {
      endRow()
      continue
    }
    field += char
  }
  if (field !== "" || row.length > 0) endRow()
  const columns = rows.reduce((max, current) => Math.max(max, current.length), 0)
  return { rows, total, columns }
}

/** Build a blob URL from loaded content. Callers revoke it when the viewer unmounts. */
export function blobUrlFromContent(content: FileContent) {
  const type = content.mimeType ?? "application/octet-stream"
  if (content.encoding !== "base64") return URL.createObjectURL(new Blob([content.content], { type }))
  const raw = atob(content.content)
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type }))
}

/**
 * Resolve a relative link against a directory. A relative base yields a workspace-relative path and
 * an absolute base an absolute one; undefined when the link climbs past the base's root.
 */
export function resolveArtifactPath(base: string, href: string) {
  const target = href.replaceAll("\\", "/")
  if (target.startsWith("/") || target === "~" || target.startsWith("~/")) return undefined
  const dir = base.replaceAll("\\", "/")
  const segments = [...dir.split("/").filter(Boolean)]
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue
    if (segment !== "..") {
      segments.push(segment)
      continue
    }
    if (segments.length === 0) return undefined
    segments.pop()
  }
  return `${dir.startsWith("/") ? "/" : ""}${segments.join("/")}`
}
