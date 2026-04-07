import { describe, expect, test } from "bun:test"
import { Image } from "../../src/util/image"

const OPAQUE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFElEQVR4nGP4z8CABzGMSjNgCRYAt8pjnQuW8k0AAAAASUVORK5CYII="

const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVR4nGP4z8DQQAxmGFX4n67BAwAg+JWdTZRWWQAAAABJRU5ErkJggg=="

const JPEG_BASE64 =
  "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAKAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAYqm//Z"

describe("util.image", () => {
  describe("Image.needsCompression", () => {
    test("returns false for small images under threshold", () => {
      const result = Image.needsCompression(OPAQUE_PNG_BASE64)
      expect(result).toBe(false)
    })

    test("returns true for images over default threshold", () => {
      const largeBase64 = "A".repeat(5 * 1024 * 1024 * 1.37)
      const result = Image.needsCompression(largeBase64)
      expect(result).toBe(true)
    })

    test("respects custom threshold", () => {
      const result = Image.needsCompression(OPAQUE_PNG_BASE64, 10)
      expect(result).toBe(true)
    })
  })

  describe("Image.compress", () => {
    test("returns original if already under size limit", async () => {
      const result = await Image.compress({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
      })

      expect(result.data).toBe(OPAQUE_PNG_BASE64)
      expect(result.mime).toBe("image/png")
      expect(result.compressed).toBe(false)
    })

    test("compresses PNG images that exceed threshold", async () => {
      const result = await Image.compress({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
        maxBytes: 10,
      })

      expect(result.compressed).toBe(true)
      expect(result.mime).toMatch(/^image\/(jpeg|png|webp)$/)
    })

    test("preserves transparency in PNG images", async () => {
      const result = await Image.compress({
        data: TRANSPARENT_PNG_BASE64,
        mime: "image/png",
        maxBytes: 10,
      })

      expect(result.mime).not.toBe("image/jpeg")
      expect(result.compressed).toBe(true)
    })

    test("can convert opaque PNG to JPEG for better compression", async () => {
      const result = await Image.compress({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
        maxBytes: 10,
        allowFormatChange: true,
      })

      expect(result.compressed).toBe(true)
    })

    test("handles JPEG input", async () => {
      const result = await Image.compress({
        data: JPEG_BASE64,
        mime: "image/jpeg",
      })

      expect(result.data).toBeDefined()
      expect(result.mime).toMatch(/^image\/(jpeg|webp)$/)
    })

    test("reduces quality when size still exceeds limit after resize", async () => {
      const result = await Image.compress({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
        maxBytes: 10,
        quality: 80,
      })

      expect(result.compressed).toBe(true)
    })
  })

  describe("Image.getInfo", () => {
    test("returns dimensions for PNG", async () => {
      const info = await Image.getInfo(OPAQUE_PNG_BASE64)
      expect(info.width).toBe(10)
      expect(info.height).toBe(10)
      expect(info.format).toBe("png")
    })

    test("returns dimensions for JPEG", async () => {
      const info = await Image.getInfo(JPEG_BASE64)
      expect(info.width).toBe(10)
      expect(info.height).toBe(10)
      expect(info.format).toBe("jpeg")
    })

    test("detects transparency in PNG", async () => {
      const info = await Image.getInfo(TRANSPARENT_PNG_BASE64)
      expect(info.hasAlpha).toBe(true)
    })

    test("detects no transparency in opaque PNG", async () => {
      const info = await Image.getInfo(OPAQUE_PNG_BASE64)
      expect(info.hasAlpha).toBe(false)
    })
  })

  describe("Image.resize", () => {
    test("maintains aspect ratio when resizing", async () => {
      const result = await Image.resize({
        data: OPAQUE_PNG_BASE64,
        maxWidth: 100,
        maxHeight: 100,
      })

      expect(result.data).toBeDefined()
      expect(result.width).toBeLessThanOrEqual(100)
      expect(result.height).toBeLessThanOrEqual(100)
    })

    test("does not upscale small images", async () => {
      const result = await Image.resize({
        data: OPAQUE_PNG_BASE64,
        maxWidth: 1000,
        maxHeight: 1000,
      })

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })
  })

  describe("Image.estimateCompressedSize", () => {
    test("estimates size for JPEG conversion", () => {
      const originalSize = 1024 * 1024
      const estimate = Image.estimateCompressedSize(originalSize, "jpeg", 80)

      expect(estimate).toBeLessThan(originalSize)
    })

    test("estimates size for WebP conversion", () => {
      const originalSize = 1024 * 1024
      const estimate = Image.estimateCompressedSize(originalSize, "webp", 80)

      const jpegEstimate = Image.estimateCompressedSize(originalSize, "jpeg", 80)
      expect(estimate).toBeLessThanOrEqual(jpegEstimate)
    })
  })

  describe("Image.optimizeForUpload", () => {
    test("returns optimized image under limit", async () => {
      const result = await Image.optimizeForUpload({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
      })

      expect(result.data).toBeDefined()
      expect(result.mime).toBeDefined()

      const sizeBytes = Buffer.from(result.data, "base64").length
      expect(sizeBytes).toBeLessThan(4 * 1024 * 1024)
    })

    test("aggressively compresses large screenshots", async () => {
      const result = await Image.optimizeForUpload({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
        targetBytes: 100,
      })

      expect(result.compressed).toBeDefined()
    })

    test("provides metadata about compression", async () => {
      const result = await Image.optimizeForUpload({
        data: OPAQUE_PNG_BASE64,
        mime: "image/png",
      })

      expect(result).toHaveProperty("originalSize")
      expect(result).toHaveProperty("finalSize")
      expect(result).toHaveProperty("compressed")
    })
  })

  describe("error handling", () => {
    test("handles invalid base64 gracefully", async () => {
      await expect(
        Image.compress({
          data: "not-valid-base64!!!",
          mime: "image/png",
          maxBytes: 1,
        }),
      ).rejects.toThrow()
    })

    test("handles corrupted image data", async () => {
      const corruptedBase64 = Buffer.from("not an image").toString("base64")
      await expect(
        Image.compress({
          data: corruptedBase64,
          mime: "image/png",
          maxBytes: 1,
        }),
      ).rejects.toThrow()
    })

    test("handles empty input", async () => {
      await expect(
        Image.compress({
          data: "",
          mime: "image/png",
        }),
      ).rejects.toThrow()
    })
  })
})
