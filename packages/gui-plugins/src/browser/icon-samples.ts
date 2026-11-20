import { crc32, deflateSync } from "node:zlib"

// Icon files as sites serve them, for the tests of the page icon (`icon-image.test.ts`, `electron-icon.fixture.ts`).
// They are written here byte by byte, apart from the product's own reader and writer, so neither can agree with a
// mistake of the other.

/** One pixel as red, green, blue and alpha, each 0–255. */
export type Pixel = readonly [number, number, number, number]

type Paint = (x: number, y: number) => Pixel

/** A square PNG file of the pixels `paint` gives. */
export function pngSample(size: number, paint: Paint) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  // 8 bits a channel, RGBA.
  header.set([8, 6, 0, 0, 0], 8)

  const rows = Array.from({ length: size }, (_, y) => [0, ...Array.from({ length: size }, (_, x) => [...paint(x, y)]).flat()])

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows.flat()))),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data])
  const frame = Buffer.alloc(8)
  frame.writeUInt32BE(data.length, 0)
  frame.writeUInt32BE(crc32(body), 4)

  return Buffer.concat([frame.subarray(0, 4), body, frame.subarray(4)])
}

/**
 * An `.ico` file of several images. An image given as `png` is stored as that PNG file, as large icons are; any other
 * is a Windows bitmap of `bits` a pixel with its transparency mask, as most sites' `favicon.ico` holds. A bitmap of 8
 * bits or fewer keeps a color table, so `paint` may give at most that many colors.
 */
export function icoSample(images: readonly ({ size: number; png: Buffer } | { size: number; bits: 1 | 4 | 8 | 24 | 32; paint: Paint })[]) {
  const files = images.map((image) => ("png" in image ? image.png : bitmap(image.size, image.bits, image.paint)))
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(images.length, 4)
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    const bits = "png" in image ? 32 : image.bits
    // A width or height of 256 is written as 0.
    directory.set([image.size & 255, image.size & 255, bits <= 8 ? (1 << bits) & 255 : 0, 0], entry)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(bits, entry + 6)
    directory.writeUInt32LE(files[index]?.length ?? 0, entry + 8)
    directory.writeUInt32LE(directory.length + files.slice(0, index).reduce((sum, file) => sum + file.length, 0), entry + 12)
  })

  return Buffer.concat([directory, ...files])
}

// A device-independent bitmap as an icon holds it: its header, color table, the pixel rows bottom-up, then one bit a
// pixel that is set where the icon is transparent. Every row is padded to four bytes.
function bitmap(size: number, bits: 1 | 4 | 8 | 24 | 32, paint: Paint) {
  const pixels = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, x) => paint(x, size - 1 - row)))
  const colors = bits <= 8 ? [...new Set(pixels.flat().map((pixel) => pixel.slice(0, 3).join()))] : []
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  // The pixel rows and the mask rows together.
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(bits, 14)
  const table = Buffer.alloc(bits <= 8 ? (1 << bits) * 4 : 0)
  colors.forEach((color, index) => {
    const [red = 0, green = 0, blue = 0] = color.split(",").map(Number)
    table.set([blue, green, red, 0], index * 4)
  })

  const rows = pixels.map((row) => {
    const line = Buffer.alloc((((size * bits + 31) >> 5) << 2))
    row.forEach((pixel, x) => {
      const [red, green, blue, alpha] = pixel

      if (bits === 32) return void line.set([blue, green, red, alpha], x * 4)

      if (bits === 24) return void line.set([blue, green, red], x * 3)
      const index = colors.indexOf(pixel.slice(0, 3).join())
      const at = (x * bits) >> 3
      line[at] = (line[at] ?? 0) | (index << (8 - bits - ((x * bits) & 7)))
    })

    return line
  })

  const mask = pixels.map((row) => {
    const line = Buffer.alloc(((size + 31) >> 5) << 2)
    row.forEach((pixel, x) => {
      if (pixel[3] === 0) line[x >> 3] = (line[x >> 3] ?? 0) | (0x80 >> (x & 7))
    })

    return line
  })

  return Buffer.concat([header, table, ...rows, ...mask])
}

/** A page's own vector icon, as modern sites list one. */
export const svgSample = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#c0ffee"/></svg>`
