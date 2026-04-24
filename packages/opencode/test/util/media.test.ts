import { describe, expect, test } from "bun:test"
import { isMedia, isPdfAttachment, isImageAttachment, sniffAttachmentMime } from "../../src/util/media"

describe("isMedia", () => {
  test("accepts image mimes", () => {
    expect(isMedia("image/png")).toBe(true)
    expect(isMedia("image/jpeg")).toBe(true)
    expect(isMedia("image/webp")).toBe(true)
    expect(isMedia("image/svg+xml")).toBe(true)
  })

  test("accepts pdf", () => {
    expect(isMedia("application/pdf")).toBe(true)
  })

  test("accepts audio mimes", () => {
    expect(isMedia("audio/wav")).toBe(true)
    expect(isMedia("audio/mpeg")).toBe(true)
    expect(isMedia("audio/ogg")).toBe(true)
  })

  test("accepts video mimes", () => {
    expect(isMedia("video/mp4")).toBe(true)
    expect(isMedia("video/webm")).toBe(true)
  })

  test("rejects non-media mimes", () => {
    expect(isMedia("text/plain")).toBe(false)
    expect(isMedia("application/json")).toBe(false)
    expect(isMedia("application/octet-stream")).toBe(false)
  })
})

describe("isPdfAttachment", () => {
  test("matches application/pdf", () => {
    expect(isPdfAttachment("application/pdf")).toBe(true)
  })

  test("rejects other types", () => {
    expect(isPdfAttachment("image/png")).toBe(false)
    expect(isPdfAttachment("application/json")).toBe(false)
  })
})

describe("isImageAttachment", () => {
  test("accepts raster image types", () => {
    expect(isImageAttachment("image/png")).toBe(true)
    expect(isImageAttachment("image/jpeg")).toBe(true)
  })

  test("excludes svg and fastbidsheet", () => {
    expect(isImageAttachment("image/svg+xml")).toBe(false)
    expect(isImageAttachment("image/vnd.fastbidsheet")).toBe(false)
  })
})

describe("sniffAttachmentMime", () => {
  const fallback = "application/octet-stream"

  test("detects PNG", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("image/png")
  })

  test("detects JPEG", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("image/jpeg")
  })

  test("detects GIF", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("image/gif")
  })

  test("detects BMP", () => {
    const bytes = new Uint8Array([0x42, 0x4d, 0x00, 0x00])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("image/bmp")
  })

  test("detects WebP", () => {
    // RIFF....WEBP
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("image/webp")
  })

  test("detects PDF", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("application/pdf")
  })

  test("detects WAV", () => {
    // RIFF....WAVE
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("audio/wav")
  })

  test("detects MP3 (sync word)", () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("audio/mpeg")
  })

  test("detects MP3 (ID3 tag)", () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("audio/mpeg")
  })

  test("detects OGG", () => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("audio/ogg")
  })

  test("detects FLAC", () => {
    const bytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("audio/flac")
  })

  test("detects MP4 (ftyp box)", () => {
    // ....ftypisom
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ])
    expect(sniffAttachmentMime(bytes, fallback)).toBe("video/mp4")
  })

  test("falls back for unknown bytes", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    expect(sniffAttachmentMime(bytes, fallback)).toBe(fallback)
  })
})
