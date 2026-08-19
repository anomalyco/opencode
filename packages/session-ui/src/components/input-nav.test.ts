import { describe, expect, test } from "bun:test"
import { computeBarWidth, extractPreviewContent } from "./input-nav-utils"
import type { Part } from "@opencode-ai/sdk/v2"

describe("computeBarWidth", () => {
  test("returns min width for empty text", () => {
    expect(computeBarWidth("")).toBe(4)
  })

  test("returns min width for very short text", () => {
    expect(computeBarWidth("hi")).toBe(4)
  })

  test("scales width proportionally to text length", () => {
    const short = computeBarWidth("hello world")
    const long = computeBarWidth("a".repeat(500))
    expect(long).toBeGreaterThan(short)
  })

  test("caps at max width for very long text", () => {
    const result = computeBarWidth("a".repeat(10000))
    expect(result).toBe(24)
  })

  test("returns integer widths", () => {
    expect(Number.isInteger(computeBarWidth("test"))).toBe(true)
    expect(Number.isInteger(computeBarWidth("a".repeat(300)))).toBe(true)
  })
})

describe("extractPreviewContent", () => {
  const makeTextPart = (text: string): Part => ({
    id: "p1",
    sessionID: "s1",
    messageID: "m1",
    type: "text",
    text,
  }) as Part

  const makeFilePart = (mime: string, filename?: string, url = "http://example.com/file"): Part => ({
    id: "p2",
    sessionID: "s1",
    messageID: "m1",
    type: "file",
    mime,
    filename,
    url,
  }) as Part

  test("extracts text from TextPart", () => {
    const parts = [makeTextPart("Hello world")]
    const result = extractPreviewContent(parts)
    expect(result.text).toBe("Hello world")
    expect(result.images).toHaveLength(0)
    expect(result.files).toHaveLength(0)
  })

  test("truncates long text to 200 characters", () => {
    const longText = "a".repeat(300)
    const parts = [makeTextPart(longText)]
    const result = extractPreviewContent(parts)
    expect(result.text?.length).toBe(203) // 200 + "..."
    expect(result.text?.endsWith("...")).toBe(true)
  })

  test("skips synthetic text parts", () => {
    const synthetic = { ...makeTextPart("synthetic"), synthetic: true } as Part
    const real = makeTextPart("real content")
    const parts = [synthetic, real]
    const result = extractPreviewContent(parts)
    expect(result.text).toBe("real content")
  })

  test("extracts image files", () => {
    const parts = [makeFilePart("image/png", "screenshot.png")]
    const result = extractPreviewContent(parts)
    expect(result.images).toHaveLength(1)
    expect(result.images[0].filename).toBe("screenshot.png")
  })

  test("extracts non-image files", () => {
    const parts = [makeFilePart("application/pdf", "document.pdf")]
    const result = extractPreviewContent(parts)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe("document.pdf")
  })

  test("separates images from other files", () => {
    const parts = [
      makeFilePart("image/png", "photo.png"),
      makeFilePart("text/plain", "readme.txt"),
      makeFilePart("image/jpeg", "diagram.jpg"),
    ]
    const result = extractPreviewContent(parts)
    expect(result.images).toHaveLength(2)
    expect(result.files).toHaveLength(1)
  })

  test("returns empty content for empty parts", () => {
    const result = extractPreviewContent([])
    expect(result.text).toBeUndefined()
    expect(result.images).toHaveLength(0)
    expect(result.files).toHaveLength(0)
  })
})
