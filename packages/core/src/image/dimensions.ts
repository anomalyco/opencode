/** Reads dimensions from inline PNG, JPEG and WebP headers without decoding pixels. */
export function dimensions(data: Uint8Array) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0xd9 || marker === 0xda) return
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 2 > bytes.length) return
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) return
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
      }
      offset += length
    }
  }

  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    offset += 8
    if (type === "VP8X" && size >= 10 && offset + 10 <= bytes.length)
      return { width: bytes.readUIntLE(offset + 4, 3) + 1, height: bytes.readUIntLE(offset + 7, 3) + 1 }
    if (type === "VP8L" && size >= 5 && offset + 5 <= bytes.length && bytes[offset] === 0x2f) {
      const bits = bytes.readUInt32LE(offset + 1)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (
      type === "VP8 " &&
      size >= 10 &&
      offset + 10 <= bytes.length &&
      bytes.subarray(offset + 3, offset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    )
      return { width: bytes.readUInt16LE(offset + 6) & 0x3fff, height: bytes.readUInt16LE(offset + 8) & 0x3fff }
    if (offset + size > bytes.length) return
    offset += size + (size % 2)
  }
}

export * as ImageDimensions from "./dimensions.js"
