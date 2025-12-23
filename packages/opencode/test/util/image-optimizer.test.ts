import { describe, expect, test, beforeAll } from "bun:test"
import { ImageOptimizer } from "../../src/cli/cmd/tui/util/image-optimizer"
import { Transformer } from "@napi-rs/image"

// Create a large PNG by generating an uncompressed BMP and converting it
// BMP with random data doesn't compress well, ensuring we get a >5MB PNG
async function createLargePNG(targetSizeMB: number = 6) {
  const scale = Math.sqrt(targetSizeMB / 6)
  const width = Math.floor(4500 * scale)
  const height = Math.floor(4500 * scale)

  // Build minimal BMP: 54-byte header + RGB pixel data
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelDataSize = rowSize * height
  const buffer = Buffer.alloc(54 + pixelDataSize)

  // BMP header
  buffer.write("BM", 0)
  buffer.writeUInt32LE(54 + pixelDataSize, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelDataSize, 34)

  // Fill with pseudo-random pixels (LCG PRNG for reproducibility)
  let state = 12345
  for (let i = 54; i < buffer.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    buffer[i] = state % 256
  }

  const png = await new Transformer(buffer).png()
  return { buffer: png, size: png.length, width, height }
}

describe("ImageOptimizer", () => {
  describe("formatBytes", () => {
    test("formats bytes correctly", () => {
      expect(ImageOptimizer.formatBytes(500)).toBe("500 B")
      expect(ImageOptimizer.formatBytes(1024)).toBe("1.00 KB")
      expect(ImageOptimizer.formatBytes(1024 * 1024)).toBe("1.00 MB")
      expect(ImageOptimizer.formatBytes(5.5 * 1024 * 1024)).toBe("5.50 MB")
    })

    test("formats edge cases", () => {
      expect(ImageOptimizer.formatBytes(0)).toBe("0 B")
      expect(ImageOptimizer.formatBytes(1)).toBe("1 B")
      expect(ImageOptimizer.formatBytes(1023)).toBe("1023 B")
      expect(ImageOptimizer.formatBytes(1024 * 1024 * 10)).toBe("10.00 MB")
    })
  })

  describe("needsOptimization", () => {
    test("returns false for images under 5MB", () => {
      expect(ImageOptimizer.needsOptimization(1024 * 1024)).toBe(false)
      expect(ImageOptimizer.needsOptimization(ImageOptimizer.SIZE_LIMIT - 1)).toBe(false)
      expect(ImageOptimizer.needsOptimization(0)).toBe(false)
    })

    test("returns true for images over 5MB", () => {
      expect(ImageOptimizer.needsOptimization(ImageOptimizer.SIZE_LIMIT + 1)).toBe(true)
      expect(ImageOptimizer.needsOptimization(10 * 1024 * 1024)).toBe(true)
      expect(ImageOptimizer.needsOptimization(ImageOptimizer.SIZE_LIMIT * 2)).toBe(true)
    })

    test("returns false for images exactly at 5MB threshold", () => {
      expect(ImageOptimizer.needsOptimization(ImageOptimizer.SIZE_LIMIT)).toBe(false)
    })
  })

  describe("optimize", () => {
    let testImage: Awaited<ReturnType<typeof createLargePNG>> | null = null
    let optimizedResult: ImageOptimizer.OptimizationResult | null = null

    beforeAll(async () => {
      testImage = await createLargePNG(6)
      optimizedResult = await ImageOptimizer.optimize(testImage.buffer)
    })

    test("optimizes large image under size limit", () => {
      expect(testImage).not.toBeNull()
      expect(optimizedResult).not.toBeNull()
      expect(testImage!.size).toBeGreaterThan(ImageOptimizer.SIZE_LIMIT)

      const resultSize = Buffer.from(optimizedResult!.data, "base64").length
      expect(resultSize).toBeLessThanOrEqual(ImageOptimizer.SIZE_LIMIT)
    })

    test("reduces dimensions when needed", async () => {
      expect(optimizedResult).not.toBeNull()
      expect(testImage).not.toBeNull()

      const resultBuffer = Buffer.from(optimizedResult!.data, "base64")
      const metadata = await new Transformer(resultBuffer).metadata()

      expect(metadata.width).toBeLessThan(testImage!.width)
      expect(metadata.height).toBeLessThan(testImage!.height)
      expect(metadata.width).toBeGreaterThanOrEqual(100)
      expect(metadata.height).toBeGreaterThanOrEqual(100)
    })

    test("result is valid base64", () => {
      expect(optimizedResult).not.toBeNull()
      expect(optimizedResult!.data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)

      const buffer = Buffer.from(optimizedResult!.data, "base64")
      expect(buffer.length).toBeGreaterThan(0)
    })

    test("preserves aspect ratio", async () => {
      expect(optimizedResult).not.toBeNull()
      expect(testImage).not.toBeNull()

      const originalAspect = testImage!.width / testImage!.height
      const resultBuffer = Buffer.from(optimizedResult!.data, "base64")
      const metadata = await new Transformer(resultBuffer).metadata()
      const finalAspect = metadata.width / metadata.height

      expect(Math.abs(finalAspect - originalAspect)).toBeLessThan(originalAspect * 0.01)
    })

    test("opaque PNG converts to JPEG", () => {
      expect(optimizedResult).not.toBeNull()
      expect(optimizedResult!.mime).toBe("image/jpeg")
    })
  })

  describe("Algorithm behavior", () => {
    test("SIZE_LIMIT is correctly defined as 5MB", () => {
      expect(ImageOptimizer.SIZE_LIMIT).toBe(5 * 1024 * 1024)
    })
  })
})
