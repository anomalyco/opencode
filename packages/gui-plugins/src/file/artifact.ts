import { base64ToBytes } from "@opencode/util/base64"
import type { FileContent } from "@opencode/plugin/gui"

/** Approximate on-disk size of loaded content. */
export function contentBytes(content: FileContent) {
  if (content.size !== undefined) return content.size

  if (content.bytes !== undefined) return content.bytes.byteLength

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

/** The raw bytes of loaded content. */
export function bytesFromContent(content: FileContent) {
  // A copy, as a viewer may move the returned buffer to a worker.
  if (content.bytes !== undefined) return content.bytes.slice()

  if (content.encoding !== "base64") return new TextEncoder().encode(content.content)

  return base64ToBytes(content.content)
}

/** Build a blob URL from loaded content. Callers revoke it when the viewer unmounts. */
export function blobUrlFromContent(content: FileContent) {
  const type = content.mimeType ?? "application/octet-stream"
  const bytes = content.bytes

  if (bytes !== undefined) {
    const view =
      bytes.buffer instanceof ArrayBuffer
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : bytes.slice()

    return URL.createObjectURL(new Blob([view], { type }))
  }

  if (content.encoding !== "base64") return URL.createObjectURL(new Blob([content.content], { type }))

  return URL.createObjectURL(new Blob([bytesFromContent(content)], { type }))
}

/**
 * Resolve a relative link against a directory. A relative base yields a workspace-relative path and
 * an absolute base an absolute one; undefined when the link climbs past the base's root.
 */
export function resolveArtifactPath(base: string, href: string) {
  const target = href.replaceAll("\\", "/")

  if (target.startsWith("/")) return undefined
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
