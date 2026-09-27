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
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF") {
    const riffType = ascii(bytes, 8, 12)
    if (riffType === "WEBP") return "image/webp"
    if (riffType === "WAVE") return "audio/wav"
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") return "video/mp4"
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg"
  // An 11-bit frame sync; layer bits `00` mark AAC ADTS, any other layer is MPEG audio.
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    return (bytes[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg"
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio/flac"
  return undefined
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
export const fileMediaType = (bytes: Uint8Array, path: string) => detectMediaType(bytes) ?? extensionMediaType(path)

/** Media type implied by a URL path's extension; the query string and fragment never count. */
export const urlMediaType = (url: string) => extensionMediaType(URL.parse(url)?.pathname ?? "")

const OPAQUE = new Set(["application/octet-stream", "binary/octet-stream"])

/**
 * A response `content-type` worth trusting over sniffing, or `undefined` for missing, malformed, or opaque types.
 * Parameters are dropped because provider `mime_type` fields reject them, except on audio, where headerless PCM
 * declarations such as `audio/L16;rate=24000` carry the only record of the sample format.
 */
export const contentMediaType = (header: string | undefined) => {
  const [essence, ...parameters] = (header ?? "").split(";").map((part) => part.trim())
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(essence) || OPAQUE.has(essence.toLowerCase())) return undefined
  if (!essence.toLowerCase().startsWith("audio/")) return essence
  return [essence, ...parameters.filter((part) => part.length > 0)].join(";")
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
