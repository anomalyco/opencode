export * as Mime from "./mime.js"

import { Media } from "@opencode/ai/effect"

/**
 * Sniff a media type from magic bytes, then let the path's extension refine it. The extension never decides a type on
 * its own: unknown text stays `text/plain` and unknown binary stays `application/octet-stream`, which callers rely on.
 */
export function detect(bytes: Uint8Array, path?: string) {
  const sniffed = Media.detectMediaType(bytes)
  if (sniffed === undefined) return isText(bytes) ? "text/plain" : "application/octet-stream"
  // `.m4a`/`.aac` only refine an `isom` brand the sniffer already matched; the `??` keeps the branch typed `string`,
  // because `fileMediaType` is declared `string | undefined`.
  return path === undefined ? sniffed : (Media.fileMediaType(bytes, path) ?? sniffed)
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
