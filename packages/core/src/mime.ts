export * as Mime from "./mime.js"
import { detectFtyp } from "@opencode/ai/internal/ftyp"

export function detect(bytes: Uint8Array) {
  return detectMedia(bytes) ?? (isText(bytes) ? "text/plain" : "application/octet-stream")
}

export function detectMedia(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  const signature = ascii(bytes, 0, 6)
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
  return detectFtyp(bytes)
}

export const isTextual = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value)
}

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
