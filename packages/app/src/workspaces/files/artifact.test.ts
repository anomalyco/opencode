import { describe, expect, test } from "bun:test"
import { fileContentFromBytes, MAX_MEDIA_BYTES } from "./artifact"
import { approxBytes } from "./content-cache"

describe("fileContentFromBytes", () => {
  test("keeps media bytes with a mime type, including videos past 25 MiB", () => {
    const png = new Uint8Array([137, 80, 78, 71])
    expect(fileContentFromBytes("a.png", png)).toEqual({
      type: "binary",
      content: "",
      bytes: png,
      mimeType: "image/png",
    })

    const video = new Uint8Array(40 * 1024 * 1024)
    const content = fileContentFromBytes("arcade-update-draft.mp4", video)
    expect(content).toEqual({
      type: "binary",
      content: "",
      bytes: video,
      mimeType: "video/mp4",
    })
    expect(approxBytes(content)).toBe(video.byteLength)
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
})
