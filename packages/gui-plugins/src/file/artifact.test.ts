import { describe, expect, test } from "bun:test"
import { bytesFromContent, contentBytes, parseDelimited, resolveArtifactPath } from "./artifact"

describe("binary content helpers", () => {
  test("reads size and independent byte copies from raw bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    const content = { type: "binary" as const, content: "", bytes, mimeType: "video/mp4" }

    expect(contentBytes(content)).toBe(4)

    const copy = bytesFromContent(content)
    expect(copy).toEqual(bytes)
    copy[0] = 9
    expect(content.bytes[0]).toBe(0)
  })
})

describe("parseDelimited", () => {
  test("handles quotes, embedded delimiters, newlines, and CRLF", () => {
    const parsed = parseDelimited('name,note\r\n"Smith, J","says ""hi""\nand more"\nplain,\n', ",")
    expect(parsed.rows).toEqual([
      ["name", "note"],
      ["Smith, J", 'says "hi"\nand more'],
      ["plain", ""],
    ])
    expect(parsed.total).toBe(3)
    expect(parsed.columns).toBe(2)
  })

  test("counts rows past the limit without keeping them", () => {
    const parsed = parseDelimited("a\tb\n1\t2\n3\t4\n5\t6", "\t", 2)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.total).toBe(4)
  })
})

describe("resolveArtifactPath", () => {
  test.each([
    ["docs", "guide.md", "docs/guide.md"],
    ["docs", "./img/a.png", "docs/img/a.png"],
    ["docs/api", "../index.md", "docs/index.md"],
    ["", "src/app.ts", "src/app.ts"],
    ["docs", "sub\\win.md", "docs/sub/win.md"],
    ["", "docs/guide.md", "docs/guide.md"],
    ["/tmp/notes/", "../out/a.pdf", "/tmp/out/a.pdf"],
    ["C:/tmp/notes/", "img.png", "C:/tmp/notes/img.png"],
    ["/repo", "../shared/report.pdf", "/shared/report.pdf"],
  ])("resolves %s + %s", (base, href, expected) => {
    expect(resolveArtifactPath(base, href)).toBe(expected)
  })

  test.each([
    ["docs", "../../etc/passwd"],
    ["", "../x"],
    ["docs", "/abs/path"],
  ])("rejects %s + %s", (base, href) => {
    expect(resolveArtifactPath(base, href)).toBeUndefined()
  })
})
