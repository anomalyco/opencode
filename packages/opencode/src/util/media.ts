const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((value, index) => bytes[index] === value)
const MP4_VIDEO_BRANDS = new Set(["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "m4v "])
const isMp4VideoBrand = (bytes: Uint8Array) => {
  const brand = Buffer.from(bytes.subarray(8, 12)).toString("ascii")
  return MP4_VIDEO_BRANDS.has(brand)
}
const isWebmDocType = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64))).toString("latin1").includes("webm")

export function isPdfAttachment(mime: string) {
  return mime === "application/pdf"
}

export function isVideoAttachment(mime: string) {
  return mime.startsWith("video/")
}

export function isMedia(mime: string) {
  return mime.startsWith("image/") || mime.startsWith("video/") || isPdfAttachment(mime)
}

export function isImageAttachment(mime: string) {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
}

export function sniffAttachmentMime(bytes: Uint8Array, fallback: string) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp"
  }
  if (bytes.length >= 12 && startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70]) && isMp4VideoBrand(bytes))
    return "video/mp4"
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && isWebmDocType(bytes)) return "video/webm"

  return fallback
}
