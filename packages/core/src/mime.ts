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
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg"
  if (isMpegFrameSync(bytes)) return "audio/mpeg"
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio/flac"
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"
  // RIFF is shared by WEBP, WAVE and AVI; the four bytes at offset 8 disambiguate.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) {
    const riffType = ascii(bytes, 8, 12)
    if (riffType === "WEBP") return "image/webp"
    if (riffType === "WAVE") return "audio/wav"
    if (riffType === "AVI ") return "video/x-msvideo"
  }
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
  return undefined
}

// MPEG audio frame sync: the leading 0xFF is followed by 11 set bits.
function isMpegFrameSync(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0
}

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
