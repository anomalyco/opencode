export * as Mime from "./mime.js"

import { Media } from "@opencode/ai/effect"

/**
 * Sniff a media type from magic bytes, then the path's extension when one is given. Text and binary fall back to
 * `text/plain` / `application/octet-stream`, which callers rely on.
 */
export function detect(bytes: Uint8Array, path?: string) {
  const media = path === undefined ? Media.detectMediaType(bytes) : Media.fileMediaType(bytes, path)
  return media ?? (isText(bytes) ? "text/plain" : "application/octet-stream")
}

/** Sniffed media type, or `undefined` when the sample carries no known signature. */
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
