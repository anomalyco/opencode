export * as Mime from "./mime.js"

import { Media } from "@opencode/ai/effect"

/**
 * Sniff a media type from magic bytes, then let the path's extension refine it. The extension never overrides a
 * textual sample: otherwise a Git-LFS pointer named `clip.mp4` would be attached as media. Text and binary fall back
 * to `text/plain` / `application/octet-stream`, which callers rely on.
 */
export function detect(bytes: Uint8Array, path?: string) {
  const sniffed = Media.detectMediaType(bytes)
  // `fileMediaType` re-runs the same sniff, so it cannot drop `sniffed` here; the `??` only keeps the branch typed
  // `string`, because `fileMediaType` is declared `string | undefined`.
  if (sniffed !== undefined) return path === undefined ? sniffed : (Media.fileMediaType(bytes, path) ?? sniffed)
  if (isText(bytes)) return "text/plain"
  if (path === undefined) return "application/octet-stream"
  return Media.fileMediaType(bytes, path) ?? "application/octet-stream"
}

/** Compatibility shim for callers that predate `detect`: sniffed media type, or `undefined` when nothing matches. */
export const detectMedia = (bytes: Uint8Array) => Media.detectMediaType(bytes)

export const isTextual = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"

function isText(bytes: Uint8Array) {
  if (bytes.length === 0) return true
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true })
  } catch {
    return false
  }
  const controls = bytes.reduce((count, byte) => count + Number(byte < 9 || (byte > 13 && byte < 32)), 0)
  return controls / bytes.length <= 0.3
}
