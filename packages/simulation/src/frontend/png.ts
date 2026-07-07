import { deflateSync } from "node:zlib"
import { TextAttributes, type CliRenderer } from "@opentui/core"

const CellWidth = 8
const CellHeight = 16

// Public-domain IBM VGA-derived font8x8 basic Latin glyphs, U+0020-U+007E.
const Font = [
  "0000000000000000", "183c3c1818001800", "3636000000000000", "36367f367f363600",
  "0c3e031e301f0c00", "006333180c666300", "1c361c6e3b336e00", "0606030000000000",
  "180c0606060c1800", "060c1818180c0600", "00663cff3c660000", "000c0c3f0c0c0000",
  "00000000000c0c06", "0000003f00000000", "00000000000c0c00", "6030180c06030100",
  "3e63737b6f673e00", "0c0e0c0c0c0c3f00", "1e33301c06333f00", "1e33301c30331e00",
  "383c36337f307800", "3f031f3030331e00", "1c06031f33331e00", "3f3330180c0c0c00",
  "1e33331e33331e00", "1e33333e30180e00", "000c0c00000c0c00", "000c0c00000c0c06",
  "180c0603060c1800", "00003f00003f0000", "060c1830180c0600", "1e3330180c000c00",
  "3e637b7b7b031e00", "0c1e33333f333300", "3f66663e66663f00", "3c66030303663c00",
  "1f36666666361f00", "7f46161e16467f00", "7f46161e16060f00", "3c66030373667c00",
  "3333333f33333300", "1e0c0c0c0c0c1e00", "7830303033331e00", "6766361e36666700",
  "0f06060646667f00", "63777f7f6b636300", "63676f7b73636300", "1c36636363361c00",
  "3f66663e06060f00", "1e3333333b1e3800", "3f66663e36666700", "1e33070e38331e00",
  "3f2d0c0c0c0c1e00", "3333333333333f00", "33333333331e0c00", "6363636b7f776300",
  "6363361c1c366300", "3333331e0c0c1e00", "7f6331184c667f00", "1e06060606061e00",
  "03060c1830604000", "1e18181818181e00", "081c366300000000", "00000000000000ff",
  "0c0c180000000000", "00001e303e336e00", "0706063e66663b00", "00001e3303331e00",
  "3830303e33336e00", "00001e333f031e00", "1c36060f06060f00", "00006e33333e301f",
  "0706366e66666700", "0c000e0c0c0c1e00", "300030303033331e", "070666361e366700",
  "0e0c0c0c0c0c1e00", "0000337f7f6b6300", "00001f3333333300", "00001e3333331e00",
  "00003b66663e060f", "00006e33333e3078", "00003b6e66060f00", "00003e031e301f00",
  "080c3e0c0c2c1800", "0000333333336e00", "00003333331e0c00", "0000636b7f7f3600",
  "000063361c366300", "00003333333e301f", "00003f190c263f00", "380c0c070c0c3800",
  "1818180018181800", "070c0c380c0c0700", "6e3b000000000000",
].map((glyph) => Uint8Array.from(glyph.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)))

export function screenshot(renderer: CliRenderer) {
  const buffer = renderer.currentRenderBuffer
  const width = buffer.width * CellWidth
  const height = buffer.height * CellHeight
  const pixels = new Uint8Array(width * height * 4)

  buffer.getSpanLines().forEach((line, row) => {
    let column = 0
    line.spans.forEach((span) => {
      const attributes = span.attributes & 0xff
      const inverse = Boolean(attributes & TextAttributes.INVERSE)
      const hidden = Boolean(attributes & TextAttributes.HIDDEN)
      const foreground = (inverse ? span.bg : span.fg).toInts()
      const background = (inverse ? span.fg : span.bg).toInts()
      const chars = [...span.text]
      let remaining = span.width

      chars.forEach((char, index) => {
        const cells = Math.max(1, remaining - (chars.length - index - 1))
        for (let cell = 0; cell < cells; cell++) drawCell(pixels, width, column + cell, row, background)
        if (!hidden) drawGlyph(pixels, width, column, row, char, foreground, background, attributes)
        column += cells
        remaining -= cells
      })
      while (remaining-- > 0) {
        drawCell(pixels, width, column++, row, background)
      }
    })
  })

  return {
    mime: "image/png" as const,
    width,
    height,
    data: encode(width, height, pixels).toString("base64"),
  }
}

function drawCell(pixels: Uint8Array, width: number, column: number, row: number, color: number[]) {
  for (let y = 0; y < CellHeight; y++) {
    for (let x = 0; x < CellWidth; x++) setPixel(pixels, width, column * CellWidth + x, row * CellHeight + y, color)
  }
}

function drawGlyph(
  pixels: Uint8Array,
  width: number,
  column: number,
  row: number,
  char: string,
  color: number[],
  background: number[],
  attributes: number,
) {
  const codepoint = char.codePointAt(0) ?? 32
  const glyph = Font[codepoint < 32 || codepoint === 0x0a00 ? 0 : codepoint <= 126 ? codepoint - 32 : 31]
  const foreground = attributes & TextAttributes.DIM ? color.map((value, index) => (value + background[index]) / 2) : color
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (!(glyph[y] & (1 << x))) continue
      const offset = attributes & TextAttributes.ITALIC ? Math.floor((7 - y) / 3) : 0
      setPixel(pixels, width, column * CellWidth + x + offset, row * CellHeight + y * 2, foreground)
      setPixel(pixels, width, column * CellWidth + x + offset, row * CellHeight + y * 2 + 1, foreground)
      if (attributes & TextAttributes.BOLD) {
        setPixel(pixels, width, column * CellWidth + x + offset + 1, row * CellHeight + y * 2, foreground)
        setPixel(pixels, width, column * CellWidth + x + offset + 1, row * CellHeight + y * 2 + 1, foreground)
      }
    }
  }
  if (attributes & TextAttributes.UNDERLINE) {
    for (let x = 0; x < CellWidth; x++)
      setPixel(pixels, width, column * CellWidth + x, row * CellHeight + 14, foreground)
  }
  if (attributes & TextAttributes.STRIKETHROUGH) {
    for (let x = 0; x < CellWidth; x++)
      setPixel(pixels, width, column * CellWidth + x, row * CellHeight + 8, foreground)
  }
}

function setPixel(pixels: Uint8Array, width: number, x: number, y: number, color: number[]) {
  if (x < 0 || x >= width || y < 0) return
  const offset = (y * width + x) * 4
  pixels[offset] = color[0]
  pixels[offset + 1] = color[1]
  pixels[offset + 2] = color[2]
  pixels[offset + 3] = color[3]
}

function encode(width: number, height: number, pixels: Uint8Array) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row++) {
    pixels.subarray(row * width * 4, (row + 1) * width * 4).forEach((byte, index) => {
      scanlines[row * (width * 4 + 1) + index + 1] = byte
    })
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data])
  const output = Buffer.alloc(body.length + 8)
  output.writeUInt32BE(data.length, 0)
  body.copy(output, 4)
  output.writeUInt32BE(crc32(body), body.length + 4)
  return output
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  data.forEach((byte) => {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  })
  return (crc ^ 0xffffffff) >>> 0
}

export * as SimulationPng from "./png"
