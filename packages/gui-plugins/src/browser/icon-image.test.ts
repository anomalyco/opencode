import { describe, expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import { iconImage } from "./icon-image"
import { icoSample, pngSample, svgSample, type Pixel } from "./icon-samples"

const solid = (...color: readonly [number, number, number]) => (): Pixel => [...color, 255]

// A picture with a transparent corner, a half-transparent pixel and a few colors.
const drawing = (x: number, y: number): Pixel =>
  x + y < 3 ? [0, 0, 0, 0] : x === 5 && y === 5 ? [200, 100, 50, 128] : (x + y) % 2 ? [220, 30, 30, 255] : [20, 60, 200, 255]

// The same without the half-transparent pixel, as a bitmap with a mask holds it.
const masked = (x: number, y: number): Pixel => (x === 5 && y === 5 ? [20, 60, 200, 255] : drawing(x, y))

// The pixels of a PNG as `iconImage` writes one: a header, then one block of unfiltered RGBA rows.
const pixels = (png: Buffer | undefined) => {
  if (!png) return undefined
  const width = png.readUInt32BE(16)
  const rows = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))

  return Array.from({ length: png.readUInt32BE(20) }, (_, y) =>
    Array.from({ length: width }, (_, x) => [...rows.subarray(y * (width * 4 + 1) + 1 + x * 4, y * (width * 4 + 1) + 5 + x * 4)]),
  )
}

const painted = (size: number, paint: (x: number, y: number) => Pixel) =>
  Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => [...paint(x, y)]))

// Transparent pixels have no color worth comparing.
const visible = (rows: number[][][] | undefined) => rows?.map((row) => row.map((pixel) => (pixel[3] === 0 ? [0, 0, 0, 0] : pixel)))

describe("an .ico file's bitmap becomes a PNG of the same pixels", () => {
  test("32 bits a pixel keeps each pixel's own transparency", () => {
    expect(visible(pixels(iconImage(icoSample([{ size: 16, bits: 32, paint: drawing }]))))).toEqual(painted(16, drawing))
  })

  test.each([24, 8, 4] as const)("%d bits a pixel takes its transparency from the mask", (bits) => {
    expect(visible(pixels(iconImage(icoSample([{ size: 16, bits, paint: masked }]))))).toEqual(painted(16, masked))
  })

  test("two colors, and a width whose rows are padded", () => {
    const paint = (x: number, y: number): Pixel => (x === y ? [0, 0, 0, 0] : x > y ? [255, 255, 255, 255] : [0, 0, 0, 255])

    expect(visible(pixels(iconImage(icoSample([{ size: 20, bits: 1, paint }]))))).toEqual(painted(20, paint))
  })

  // Tools that predate transparency wrote 32 bits with that byte zero throughout: the mask says what shows.
  test("32 bits with no transparency written is as opaque as its mask says", () => {
    const file = icoSample([{ size: 16, bits: 32, paint: masked }])
    // The pixels follow the 6-byte file header, one 16-byte entry and the bitmap's 40-byte header.
    Array.from({ length: 16 * 16 }, (_, index) => 62 + index * 4 + 3).forEach((at) => (file[at] = 0))

    expect(visible(pixels(iconImage(file)))).toEqual(painted(16, masked))
  })
})

describe("the image of an .ico file that is kept", () => {
  const sizes = (...images: readonly (readonly [number, 4 | 32, number])[]) =>
    icoSample(images.map(([size, bits, red]) => ({ size, bits, paint: solid(red, 0, 0) })))

  const kept = (file: Buffer) => {
    const rows = pixels(iconImage(file))

    return [rows?.length, rows?.[0]?.[0]?.[0]]
  }

  test.each([
    ["the 32px image", sizes([16, 32, 1], [32, 32, 2], [48, 32, 3]), [32, 2]],
    ["else the smallest larger one", sizes([16, 32, 1], [64, 32, 2], [48, 32, 3]), [48, 3]],
    ["else the largest", sizes([16, 32, 1], [24, 32, 2], [20, 32, 3]), [24, 2]],
    ["of two the same size, the one with more colors", sizes([32, 4, 1], [32, 32, 2]), [32, 2]],
    ["a single small one", sizes([16, 32, 1]), [16, 1]],
    ["a size no icon usually has", sizes([150, 32, 1]), [150, 1]],
    [
      "a bitmap nearer the kept size than the PNG beside it",
      icoSample([{ size: 16, bits: 32, paint: solid(1, 0, 0) }, { size: 64, bits: 32, paint: solid(2, 0, 0) }, { size: 256, png: pngSample(256, solid(3, 0, 0)) }]),
      [64, 2],
    ],
  ])("%s", (_name, file, expected) => {
    expect(kept(file)).toEqual(expected)
  })

  test("a PNG inside is kept as it is", () => {
    const png = pngSample(64, solid(1, 2, 3))

    expect(iconImage(icoSample([{ size: 16, bits: 32, paint: solid(9, 9, 9) }, { size: 64, png }]))).toEqual(png)
  })

  test("an image the file does not hold in full gives way to the next", () => {
    const file = sizes([16, 32, 1], [32, 32, 2])

    // The 32px image is last in the file: without its final rows, the 16px one is the icon.
    expect(kept(file.subarray(0, file.length - 2_000))).toEqual([16, 1])
  })
})

// Whatever a server calls the file: a PNG named favicon.ico is common.
test("a PNG or a JPEG is its own image", () => {
  const png = pngSample(180, solid(4, 5, 6))
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])

  expect(iconImage(png)).toBe(png)
  expect(iconImage(jpeg)).toBe(jpeg)
})

test.each([
  // An SVG is reported by its type as it is, and never read here.
  ["an SVG", Buffer.from(svgSample)],
  ["an SVG after an XML declaration", Buffer.from(`<?xml version="1.0"?>${svgSample}`)],
  ["a page", Buffer.from("<!doctype html><title>Not found</title>")],
  ["a GIF", Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1")],
  ["nothing", Buffer.alloc(0)],
  ["bytes of no format", Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37) & 255))],
  ["an .ico file with no image", icoSample([])],
  ["an .ico file cut inside its list of images", icoSample([{ size: 16, bits: 32, paint: solid(1, 1, 1) }]).subarray(0, 20)],
  ["an .ico file cut inside its only image", icoSample([{ size: 32, bits: 32, paint: solid(1, 1, 1) }]).subarray(0, 900)],
  [
    "an .ico file whose bitmap is compressed",
    (() => {
      const file = icoSample([{ size: 16, bits: 8, paint: solid(1, 1, 1) }])
      // The bitmap header's compression field: run-length encoding.
      file.writeUInt32LE(1, 22 + 16)

      return file
    })(),
  ],
  [
    "an .ico file whose bitmap claims a size no icon has",
    (() => {
      const file = icoSample([{ size: 16, bits: 32, paint: solid(1, 1, 1) }])
      file.writeInt32LE(100_000, 22 + 4)

      return file
    })(),
  ],
])("%s is no image nativeImage reads", (_name, file) => {
  expect(iconImage(file)).toBeUndefined()
})
