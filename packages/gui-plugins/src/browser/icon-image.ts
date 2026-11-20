import { crc32, deflateSync } from "node:zlib"

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The size a page's icon is kept at: twice the 16px it is drawn at, so it stays sharp on a 2x display. */
export const ICON_SIZE = 32

/**
 * An icon file as an image Electron's `nativeImage` reads, which is PNG and JPEG only: the file itself when it is one
 * of those, else the best image of an `.ico` file, which is what most sites serve. Undefined for anything else: markup,
 * a format read by neither (GIF, WebP, AVIF), or a file cut short. The bytes decide, never the type a server declared.
 */
export function iconImage(file: Buffer): Buffer | undefined {
  if (starts(file, PNG) || starts(file, [0xff, 0xd8, 0xff])) return file

  // An .ico file: a reserved zero, the type 1, the number of images, then 16 bytes for each.
  if (!starts(file, [0, 0, 1, 0]) || file.length < 6) return

  return Array.from({ length: Math.min(file.readUInt16LE(4), Math.floor((file.length - 6) / 16)) }, (_, index) => {
    const entry = 6 + index * 16
    const start = file.readUInt32LE(entry + 12)

    // A width or height of 256 is written as 0. An image that runs past the file's end is empty.
    return { size: Math.max(file[entry] || 256, file[entry + 1] || 256), data: file.subarray(start, start + file.readUInt32LE(entry + 8)) }
  })
    .sort((a, b) => rank(a.size) - rank(b.size) || depth(b.data) - depth(a.data))
    .reduce<Buffer | undefined>((found, entry) => found ?? (starts(entry.data, PNG) ? entry.data : bitmap(entry.data)), undefined)
}

function starts(file: Buffer, bytes: readonly number[]) {
  return bytes.every((byte, index) => file[index] === byte)
}

// The image at the kept size first, then larger ones from the smallest, which are reduced, then smaller ones from the
// largest.
function rank(size: number) {
  return size >= ICON_SIZE ? size - ICON_SIZE : 256 + ICON_SIZE - size
}

// Bits a pixel, which says how many colors an image of the same size has.
function depth(data: Buffer) {
  return starts(data, PNG) ? 32 : data.length >= 16 ? data.readUInt16LE(14) : 0
}

/**
 * An icon's Windows bitmap as a PNG: its header, a color table for 8 bits a pixel or fewer, the pixel rows from the
 * bottom up, then a mask of one bit a pixel that is set where the icon is transparent. Undefined for a compressed
 * bitmap, a size no icon has, or rows the file does not hold.
 */
function bitmap(data: Buffer) {
  if (data.length < 40) return
  const header = data.readUInt32LE(0)
  const width = data.readInt32LE(4)
  // The header counts the pixel rows and the mask rows together.
  const height = data.readInt32LE(8) >> 1
  const bits = data.readUInt16LE(14)

  if (header < 40 || width < 1 || width > 256 || height < 1 || height > 256 || data.readUInt32LE(16) !== 0) return

  if (![1, 4, 8, 24, 32].includes(bits)) return
  const colors = bits <= 8 ? data.readUInt32LE(32) || 1 << bits : 0
  const pixels = header + colors * 4
  // Every row is padded to four bytes.
  const stride = ((width * bits + 31) >> 5) << 2
  const mask = pixels + stride * height
  const maskStride = ((width + 31) >> 5) << 2

  if (colors > 256 || mask > data.length) return
  const masked = mask + maskStride * height <= data.length
  // A 32-bit image carries its own transparency, unless a tool that wrote only the mask left that byte zero throughout.
  const alpha = bits === 32 && Array.from({ length: width * height }, (_, index) => index).some((index) => data[pixels + index * 4 + 3] !== 0)
  const line = width * 4 + 1
  // PNG rows from the top down, each after a zero for "no filter", as red, green, blue and alpha.
  const rows = Buffer.alloc(height * line)

  for (let y = 0; y < height; y++) {
    const row = pixels + (height - 1 - y) * stride
    const maskRow = mask + (height - 1 - y) * maskStride

    for (let x = 0; x < width; x++) {
      const index = bits <= 8 ? ((data[row + ((x * bits) >> 3)] ?? 0) >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1) : 0
      const color = bits <= 8 ? header + index * 4 : row + x * (bits >> 3)
      const hidden = masked && ((data[maskRow + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0

      rows.set(
        [data[color + 2] ?? 0, data[color + 1] ?? 0, data[color] ?? 0, alpha ? (data[color + 3] ?? 0) : hidden ? 0 : 255],
        y * line + 1 + x * 4,
      )
    }
  }

  const size = Buffer.alloc(13)
  size.writeUInt32BE(width, 0)
  size.writeUInt32BE(height, 4)
  // 8 bits a channel, with alpha.
  size.set([8, 6, 0, 0, 0], 8)

  return Buffer.concat([Buffer.from(PNG), chunk("IHDR", size), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}

// A PNG chunk: its length, its name and data, and their checksum.
function chunk(name: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(name, "latin1"), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))

  return Buffer.concat([length, body, checksum])
}
