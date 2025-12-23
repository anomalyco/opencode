import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { ImageOptimizer } from "../../src/util/image-optimizer"
import { Transformer } from "@napi-rs/image"
import { getLargeTestImage, getSmallTestImage, clearImageCache } from "../fixture/image"

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
    let testImage: Awaited<ReturnType<typeof getLargeTestImage>> | null = null
    let optimizedResult: ImageOptimizer.OptimizationResult | null = null

    beforeAll(async () => {
      testImage = await getLargeTestImage()
      optimizedResult = await ImageOptimizer.optimize(testImage.buffer)
    })

    afterAll(() => {
      clearImageCache()
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

  describe("optimize (small image - no optimization needed)", () => {
    let smallImage: Awaited<ReturnType<typeof getSmallTestImage>> | null = null
    let result: ImageOptimizer.OptimizationResult | null = null

    beforeAll(async () => {
      smallImage = await getSmallTestImage()
      result = await ImageOptimizer.optimize(smallImage.buffer)
    })

    afterAll(() => {
      clearImageCache()
    })

    test("small image is under size limit", () => {
      expect(smallImage).not.toBeNull()
      expect(smallImage!.size).toBeLessThan(ImageOptimizer.SIZE_LIMIT)
    })

    test("returns image without dimension reduction", async () => {
      expect(result).not.toBeNull()
      expect(smallImage).not.toBeNull()

      const resultBuffer = Buffer.from(result!.data, "base64")
      const metadata = await new Transformer(resultBuffer).metadata()

      // Dimensions should remain the same since no optimization was needed
      expect(metadata.width).toBe(smallImage!.width)
      expect(metadata.height).toBe(smallImage!.height)
    })

    test("result is valid base64", () => {
      expect(result).not.toBeNull()
      expect(result!.data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)
    })
  })

  describe("Algorithm behavior", () => {
    test("SIZE_LIMIT is correctly defined as 5MB", () => {
      expect(ImageOptimizer.SIZE_LIMIT).toBe(5 * 1024 * 1024)
    })
  })
})
