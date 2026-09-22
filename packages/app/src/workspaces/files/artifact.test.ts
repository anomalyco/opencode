import { describe, expect, test } from "bun:test"
import {
  artifactKind,
  bytesToBase64,
  contentBytes,
  fileContentFromBytes,
  MAX_MEDIA_BYTES,
  parseDelimited,
  resolveArtifactPath,
} from "./artifact"

describe("artifactKind", () => {
  test.each([
    ["shot.PNG", "image"],
    ["logo.svg", "svg"],
    ["song.mp3", "audio"],
    ["demo.mp4", "video"],
    ["clip.webm", "video"],
    ["paper.pdf", "pdf"],
    ["out/index.html", "html"],
    ["README.md", "markdown"],
    ["flow.mmd", "mermaid"],
    ["data.csv", "table"],
    ["data.tsv", "table"],
    ["Inter.woff2", "font"],
    ["src/app.ts", "text"],
    ["Makefile", "text"],
    [".env", "text"],
    ["archive.tar.gz", "text"],
  ] as const)("classifies %s as %s", (path, kind) => {
    expect(artifactKind(path)).toBe(kind)
  })
})

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

describe("contentBytes", () => {
  test("recovers byte counts from base64 and text", () => {
    expect(contentBytes({ type: "binary", content: "iVBORw==", encoding: "base64" })).toBe(4)
    expect(contentBytes({ type: "binary", content: "iVBORwA=", encoding: "base64" })).toBe(5)
    expect(contentBytes({ type: "text", content: "héllo" })).toBe(6)
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
    ["docs", "~/notes.md"],
    ["/repo/docs", "~/../shared/notes.md"],
    ["docs", "~\\notes.md"],
    ["docs", "~"],
  ])("rejects %s + %s", (base, href) => {
    expect(resolveArtifactPath(base, href)).toBeUndefined()
  })
})
