const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8)
const u32be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
const u32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0

/**
 * Reads image width and height directly from PNG, JPEG, GIF, or WebP headers without decoding pixel data.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mime?: string,
): { readonly width: number; readonly height: number } | undefined {
  if (mime !== undefined && !mime.startsWith("image/")) return undefined

  // PNG: 8-byte signature + IHDR chunk (4-byte length, "IHDR", 4-byte width BE, 4-byte height BE)
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const width = u32be(bytes, 16)
    const height = u32be(bytes, 20)
    return width > 0 && height > 0 ? { width, height } : undefined
  }

  // GIF: "GIF87a" or "GIF89a" + 2-byte width LE + 2-byte height LE
  if (
    bytes.byteLength >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    const width = u16le(bytes, 6)
    const height = u16le(bytes, 8)
    return width > 0 && height > 0 ? { width, height } : undefined
  }

  // WebP: "RIFF" + size + "WEBP" + ("VP8 " | "VP8L" | "VP8X")
  if (
    bytes.byteLength >= 25 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    bytes[12] === 0x56 &&
    bytes[13] === 0x50 &&
    bytes[14] === 0x38
  ) {
    const kind = bytes[15]
    if (
      kind === 0x20 &&
      bytes.byteLength >= 30 &&
      (bytes[20]! & 1) === 0 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      const width = u16le(bytes, 26) & 0x3fff
      const height = u16le(bytes, 28) & 0x3fff
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (kind === 0x4c && bytes[20] === 0x2f) {
      const bits = u32le(bytes, 21)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >>> 14) & 0x3fff) + 1
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (kind === 0x58 && bytes.byteLength >= 30) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
      return width > 0 && height > 0 ? { width, height } : undefined
    }
  }

  // JPEG: walk markers from SOI (0xff 0xd8) to SOFn
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 1 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++
      if (offset >= bytes.byteLength) break
      const marker = bytes[offset]!
      offset++
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (marker === 0xd9 || marker === 0xda) break
      if (offset + 1 >= bytes.byteLength) break
      const segLength = u16be(bytes, offset)
      if (segLength < 2 || offset + segLength > bytes.byteLength) break
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof && segLength >= 7) {
        const height = u16be(bytes, offset + 3)
        const width = u16be(bytes, offset + 5)
        return width > 0 && height > 0 ? { width, height } : undefined
      }
      offset += segLength
    }
  }

  return undefined
}
