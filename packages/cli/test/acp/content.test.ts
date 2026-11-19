import { describe, expect, test } from "bun:test"
import { partsToContentChunks, promptContentToParts } from "../../src/acp/content"

describe("ACP attachment filenames", () => {
  test("decodes file URI names", () => {
    const parts = promptContentToParts([
      { type: "image", data: "", mimeType: "image/png", uri: "file:///tmp/photo%201.png" },
    ])

    expect(parts).toEqual([
      { type: "file", url: "file:///tmp/photo%201.png", filename: "photo 1.png", mime: "image/png" },
    ])
  })

  test("decodes image names when image data is embedded", () => {
    const parts = promptContentToParts([
      { type: "image", data: "AAAA", mimeType: "image/png", uri: "file:///tmp/photo%201.png" },
    ])

    expect(parts[0]).toMatchObject({ filename: "photo 1.png" })

    const content = partsToContentChunks(parts)[0]?.content as { type: "image"; uri: string }
    expect(content.uri).toContain("photo%201.png")
    expect(content.uri).not.toContain("%25")
  })

  test("decodes embedded resource names and does not double-encode on replay", () => {
    const parts = promptContentToParts([
      {
        type: "resource",
        resource: {
          uri: "file:///tmp/caf%C3%A9%20%231.bin",
          mimeType: "application/octet-stream",
          blob: "aGk=",
        },
      },
    ])

    expect(parts[0]).toMatchObject({ filename: "café #1.bin" })

    const chunks = partsToContentChunks(parts)
    expect(chunks[0]?.content.type).toBe("resource")
    const uri = (chunks[0]?.content as { resource: { uri: string } }).resource.uri
    expect(uri).toContain("caf%C3%A9%20%231.bin")
    expect(uri).not.toContain("%25")
  })

  test("does not turn decoded separators into nested paths", () => {
    const file = promptContentToParts([
      {
        type: "resource",
        resource: {
          uri: "file:///tmp/a%2Fb.png",
          mimeType: "image/png",
          blob: "aGk=",
        },
      },
    ])
    expect(file[0]).toMatchObject({ filename: "b.png" })

    const http = promptContentToParts([
      {
        type: "resource",
        resource: {
          uri: "https://example.com/a%5Cb.png",
          mimeType: "image/png",
          blob: "aGk=",
        },
      },
    ])
    expect(http[0]).toMatchObject({ filename: "b.png" })
  })

  test("keeps malformed http path segments unchanged", () => {
    const parts = promptContentToParts([
      {
        type: "resource",
        resource: {
          uri: "https://example.com/bad%zz.png",
          mimeType: "application/octet-stream",
          blob: "aGk=",
        },
      },
    ])

    expect(parts[0]).toMatchObject({ filename: "bad%zz.png" })
  })
})
