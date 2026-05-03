import type { FileContent } from "@opencode-ai/sdk/v2"
// FORK: office-pdf-ref protocol — side-band MIME marker shared with opencode/file/index.ts;跟上游 shared → core rename 走 2026-05-03
import { isOfficePdfRefMime } from "@opencode-ai/core/office-pdf-protocol"

export type MediaKind = "image" | "audio" | "svg" | "pdf"

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic"])
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"])
const pdfLikeExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
])

type MediaValue = unknown

function mediaRecord(value: unknown) {
  if (!value || typeof value !== "object") return
  return value as Partial<FileContent> & {
    content?: unknown
    encoding?: unknown
    mimeType?: unknown
    type?: unknown
  }
}

export function normalizeMimeType(type: string | undefined) {
  if (!type) return
  const mime = type.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return
  if (mime === "audio/x-aac") return "audio/aac"
  if (mime === "audio/x-m4a") return "audio/mp4"
  return mime
}

export function fileExtension(path: string | undefined) {
  if (!path) return ""
  const idx = path.lastIndexOf(".")
  if (idx === -1) return ""
  return path.slice(idx + 1).toLowerCase()
}

export function mediaKindFromPath(path: string | undefined): MediaKind | undefined {
  const ext = fileExtension(path)
  if (ext === "svg") return "svg"
  if (imageExtensions.has(ext)) return "image"
  if (audioExtensions.has(ext)) return "audio"
  if (pdfLikeExtensions.has(ext)) return "pdf"
}

export function isBinaryContent(value: MediaValue) {
  return mediaRecord(value)?.type === "binary"
}

function validDataUrl(value: string, kind: MediaKind) {
  if (kind === "svg") return value.startsWith("data:image/svg+xml") ? value : undefined
  if (kind === "image") return value.startsWith("data:image/") ? value : undefined
  if (value.startsWith("data:audio/x-aac;")) return value.replace("data:audio/x-aac;", "data:audio/aac;")
  if (value.startsWith("data:audio/x-m4a;")) return value.replace("data:audio/x-m4a;", "data:audio/mp4;")
  if (value.startsWith("data:audio/")) return value
}

export function dataUrlFromMediaValue(value: MediaValue, kind: MediaKind) {
  if (!value) return

  if (typeof value === "string") {
    return validDataUrl(value, kind)
  }

  const record = mediaRecord(value)
  if (!record) return

  if (typeof record.content !== "string") return

  const mime = normalizeMimeType(typeof record.mimeType === "string" ? record.mimeType : undefined)
  if (!mime) return

  if (kind === "svg") {
    if (mime !== "image/svg+xml") return
    if (record.encoding === "base64") return `data:image/svg+xml;base64,${record.content}`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(record.content)}`
  }

  if (kind === "image" && !mime.startsWith("image/")) return
  if (kind === "audio" && !mime.startsWith("audio/")) return
  if (record.encoding !== "base64") return

  return `data:${mime};base64,${record.content}`
}

function decodeBase64Utf8(value: string) {
  if (typeof atob !== "function") return

  try {
    const raw = atob(value)
    const bytes = Uint8Array.from(raw, (x) => x.charCodeAt(0))
    if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes)
    return raw
  } catch {}
}

function decodeBase64Bytes(value: string): Uint8Array | undefined {
  if (typeof atob !== "function") return
  try {
    const raw = atob(value)
    return Uint8Array.from(raw, (x) => x.charCodeAt(0))
  } catch {
    return undefined
  }
}

export function arrayBufferFromMediaValue(value: MediaValue): Uint8Array | undefined {
  const record = mediaRecord(value)
  if (!record) return
  // Direct in-memory bytes (set by app layer after binary fetch)
  const direct = (record as { bytes?: unknown }).bytes
  if (direct instanceof Uint8Array) return direct
  if (typeof record.content !== "string") return
  if (record.encoding !== "base64") return
  return decodeBase64Bytes(record.content)
}

export function isOfficePdfRef(value: MediaValue): boolean {
  // FORK: detect via vendor MIME instead of encoding enum 2026-05-03
  const record = mediaRecord(value)
  return isOfficePdfRefMime(typeof record?.mimeType === "string" ? record.mimeType : undefined)
}

export function svgTextFromValue(value: MediaValue) {
  const record = mediaRecord(value)
  if (!record) return
  if (typeof record.content !== "string") return

  const mime = normalizeMimeType(typeof record.mimeType === "string" ? record.mimeType : undefined)
  if (mime !== "image/svg+xml") return
  if (record.encoding === "base64") return decodeBase64Utf8(record.content)
  return record.content
}

export function hasMediaValue(value: MediaValue) {
  if (typeof value === "string") return value.length > 0
  const record = mediaRecord(value)
  if (!record) return false
  return typeof record.content === "string" && record.content.length > 0
}
