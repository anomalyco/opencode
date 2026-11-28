export * as Mime from "./mime.js"

export function detect(bytes: Uint8Array) {
  return detectMedia(bytes) ?? (isText(bytes) ? "text/plain" : "application/octet-stream")
}

export function detectMedia(bytes: Uint8Array) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  const signature = ascii(bytes, 0, 6)
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"
  if (bytes.length >= 18 && startsWith(bytes, [0x42, 0x4d])) {
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const pixels = header.getUint32(10, true)
    const dib = header.getUint32(14, true)
    // Pixels follow the 14-byte file header and a Windows or OS/2 DIB header, possibly beyond this sample.
    if ([12, 16, 40, 52, 56, 64, 108, 124].includes(dib) && pixels >= 14 + dib) return "image/bmp"
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  // Matroska shares EBML's signature; only WebM's header names its DocType `webm`.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && ascii(bytes, 0, Math.min(bytes.length, 64)).includes("webm"))
    return "video/webm"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))
    return "image/webp"
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    // AVIF, HEIC, QuickTime and M4A share MP4's container; the major brand tells them apart, and generic HEIF brands
    // list `avif`/`avis` among the compatible brands that follow the minor version.
    const brand = ascii(bytes, 8, 12)
    const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), bytes.length)
    const compatible = Array.from({ length: Math.floor((boxEnd - 16) / 4) }, (_, index) =>
      ascii(bytes, 16 + index * 4, 20 + index * 4),
    )
    const generic = brand === "mif1" || brand === "msf1"
    if (
      brand === "avif" ||
      brand === "avis" ||
      (generic && (compatible.includes("avif") || compatible.includes("avis")))
    )
      return "image/avif"
    if (generic || ["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic"
    if (brand === "qt  ") return "video/quicktime"
    if (brand === "M4A ") return "audio/mp4"
    return "video/mp4"
  }
  const pdf = ascii(bytes, 0, 1024).search(/%PDF-\d\.\d\s*%[\x80-\xff]{4}/)
  if (pdf > 0 && isText(bytes.subarray(0, pdf)) && !isText(bytes)) return "application/pdf"
  return undefined
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
