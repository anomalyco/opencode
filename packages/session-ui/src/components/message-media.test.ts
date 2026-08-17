import { describe, expect, test } from "bun:test"
import { mediaLabel, supportedImageMime } from "./message-media"

describe("supportedImageMime", () => {
  test("accepts the ordered-media conformance profile", () => {
    expect(["image/png", "image/jpeg", "image/webp", "image/gif"].every(supportedImageMime)).toBe(true)
  })

  test("rejects unsupported and active image formats", () => {
    expect(supportedImageMime("image/svg+xml")).toBe(false)
    expect(supportedImageMime("application/pdf")).toBe(false)
  })
})

describe("mediaLabel", () => {
  test("prefers the filename and falls back to the MIME type", () => {
    expect(mediaLabel({ filename: "diagram.png", mime: "image/png" })).toBe("diagram.png")
    expect(mediaLabel({ mime: "image/webp" })).toBe("image/webp")
  })
})
