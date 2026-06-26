import { describe, expect, test } from "bun:test"
import { isMedia, isImageAttachment, isPdfAttachment } from "@/util/media"

describe("isMedia", () => {
  test("recognizes images", () => {
    expect(isMedia("image/png")).toBe(true)
    expect(isMedia("image/jpeg")).toBe(true)
    expect(isMedia("image/webp")).toBe(true)
    expect(isMedia("image/gif")).toBe(true)
  })

  test("recognizes video", () => {
    expect(isMedia("video/mp4")).toBe(true)
    expect(isMedia("video/webm")).toBe(true)
    expect(isMedia("video/quicktime")).toBe(true)
  })

  test("recognizes audio", () => {
    expect(isMedia("audio/mp3")).toBe(true)
    expect(isMedia("audio/mpeg")).toBe(true)
    expect(isMedia("audio/wav")).toBe(true)
    expect(isMedia("audio/ogg")).toBe(true)
  })

  test("recognizes pdf", () => {
    expect(isMedia("application/pdf")).toBe(true)
  })

  test("rejects non-media types", () => {
    expect(isMedia("text/plain")).toBe(false)
    expect(isMedia("application/json")).toBe(false)
    expect(isMedia("text/html")).toBe(false)
  })
})

describe("isImageAttachment", () => {
  test("matches image mime types", () => {
    expect(isImageAttachment("image/png")).toBe(true)
    expect(isImageAttachment("video/mp4")).toBe(false)
  })
})

describe("isPdfAttachment", () => {
  test("matches pdf mime type", () => {
    expect(isPdfAttachment("application/pdf")).toBe(true)
    expect(isPdfAttachment("image/png")).toBe(false)
  })
})
