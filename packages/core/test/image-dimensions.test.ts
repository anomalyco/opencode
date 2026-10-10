import { expect, test } from "bun:test"
import { ImageDimensions } from "@opencode/core/image/dimensions"
import images from "./fixtures/image-minimum.json"

test("reads real PNG, baseline and progressive JPEG, lossy and lossless WebP", () => {
  for (const image of images)
    expect(ImageDimensions.dimensions(Buffer.from(image.data, "base64"))).toEqual({
      width: image.width,
      height: image.height,
    })
})

test("truncated and unrelated headers do not throw", () => {
  for (const image of images) {
    const bytes = Buffer.from(image.data, "base64")
    for (let length = 0; length < bytes.length; length++)
      expect(() => ImageDimensions.dimensions(bytes.subarray(0, length))).not.toThrow()
  }
  expect(ImageDimensions.dimensions(Buffer.from("hello"))).toBeUndefined()
})

test("reads WebP dimensions without the complete compressed chunk", () => {
  for (const image of images.filter((image) => image.mime === "image/webp")) {
    const bytes = Buffer.from(image.data, "base64")
    const length = bytes.toString("ascii", 12, 16) === "VP8L" ? 25 : 30
    expect(ImageDimensions.dimensions(bytes.subarray(0, length))).toEqual({
      width: image.width,
      height: image.height,
    })
    expect(ImageDimensions.dimensions(bytes.subarray(0, length - 1))).toBeUndefined()
  }
})
