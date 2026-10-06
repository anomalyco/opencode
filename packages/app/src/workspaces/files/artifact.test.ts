import { describe, expect, test } from "bun:test"
import { bytesToBase64, fileContentFromBytes, MAX_MEDIA_BYTES } from "./artifact"

describe("fileContentFromBytes", () => {
  test("keeps media as base64 with a mime type", () => {
    const content = fileContentFromBytes("a.png", new Uint8Array([137, 80, 78, 71]))
    expect(content).toEqual({ type: "binary", content: "iVBORw==", encoding: "base64", mimeType: "image/png" })
  })

  test("decodes text and svg with a mime type", () => {
    expect(fileContentFromBytes("a.svg", new TextEncoder().encode("<svg/>"))).toEqual({
      type: "text",
      content: "<svg/>",
      mimeType: "image/svg+xml",
    })
    expect(fileContentFromBytes("a.ts", new TextEncoder().encode("const a = 1"))).toEqual({
      type: "text",
      content: "const a = 1",
      mimeType: undefined,
    })
  })

  test("keeps only the size of media above the cap", () => {
    const content = fileContentFromBytes("big.mp4", new Uint8Array(MAX_MEDIA_BYTES + 1))
    expect(content).toEqual({ type: "binary", content: "", size: MAX_MEDIA_BYTES + 1 })
  })

  test("marks unknown binaries without keeping bytes", () => {
    expect(fileContentFromBytes("a.bin", new Uint8Array([1, 0, 2]))).toEqual({ type: "binary", content: "", size: 3 })
  })

  test("encodes large buffers in chunks", () => {
    const bytes = new Uint8Array(70_000).fill(65)
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"))
  })
})
