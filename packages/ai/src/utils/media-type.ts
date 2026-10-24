const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

const startsWith = (bytes: Uint8Array, prefix: ReadonlyArray<number>) =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)

/**
 * Sniff a media type from leading magic bytes. Covers the containers media routes commonly return; anything else is
 * `undefined` so callers can fall back to a provider-declared type or `application/octet-stream`.
 */
export const detectMediaType = (bytes: Uint8Array): string | undefined => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp"
  // RIFF is shared by WEBP, WAVE and AVI; the four bytes at offset 8 disambiguate.
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") {
    const riffType = ascii(bytes, 8, 12)
    if (riffType === "WEBP") return "image/webp"
    if (riffType === "WAVE") return "audio/wav"
    if (riffType === "AVI ") return "video/x-msvideo"
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"
  // ftyp is shared by AVIF, M4A, MOV and MP4; the major brand at offset 8 disambiguates.
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
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg"
  const frame = frameSyncMediaType(bytes)
  if (frame !== undefined) return frame
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio/flac"
  return undefined
}

/**
 * An 11-bit MPEG/AAC frame sync; layer bits `00` mark AAC ADTS, any other layer is MPEG audio. `FF FE` is also the
 * UTF-16LE byte-order mark, so rule it out and require a valid version, bitrate and sample-rate header.
 */
const frameSyncMediaType = (bytes: Uint8Array): string | undefined => {
  if (bytes.length < 4) return undefined
  if (bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return undefined
  if (bytes[1] === 0xfe) return undefined
  const version = (bytes[1] >> 3) & 0x03
  const bitrate = (bytes[2] >> 4) & 0x0f
  const sampleRate = (bytes[2] >> 2) & 0x03
  if (version === 0x01 || bitrate === 0x00 || bitrate === 0x0f || sampleRate === 0x03) return undefined
  return (bytes[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg"
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
}

const extensionMediaType = (path: string): string | undefined =>
  EXTENSIONS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()]

/** Media type of a file's contents: sniffed magic bytes, then the path's extension. */
export const fileMediaType = (bytes: Uint8Array, path: string) => {
  const sniffed = detectMediaType(bytes)
  const extension = extensionMediaType(path)
  // The ftyp container is shared by audio-only and video files; the extension disambiguates.
  if (sniffed === "video/mp4" && extension?.startsWith("audio/")) return extension
  return sniffed ?? extension
}

const EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  "audio/mp3": "mp3",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/x-flac": "flac",
}

export const mediaTypeExtension = (mediaType: string): string | undefined => {
  const type = mediaType.split(";", 1)[0].trim().toLowerCase()
  return EXTENSION_ALIASES[type] ?? Object.entries(EXTENSIONS).find(([, known]) => known === type)?.[0]
}
