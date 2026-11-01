import { describe, expect, test } from "bun:test"
import { bytesFromContent, contentBytes, parseDelimited, previewMarkdown, resolveArtifactPath } from "./artifact"

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

describe("previewMarkdown", () => {
  test.each([
    ["LF frontmatter and body", "---\ndescription: Release\nmode: primary\n---\n# Title", "```yaml\ndescription: Release\nmode: primary\n```\n\n# Title"],
    ["CRLF and UTF-8 BOM", "\uFEFF---\r\ndescription: Release\r\n---\r\n# Title\r\n", "```yaml\ndescription: Release\n```\n\n# Title\r\n"],
    ["frontmatter at EOF", "---\nmode: primary\n---", "```yaml\nmode: primary\n```"],
    ["frontmatter with trailing blank lines only", "---\nmode: primary\n---\n\n", "```yaml\nmode: primary\n```"],
    ["empty frontmatter before a later thematic break", "---\n---\n\nBody\n\n---\n\nFooter", "\nBody\n\n---\n\nFooter"],
    ["whitespace-only frontmatter", "---\n  \n---\n# Title", "# Title"],
    ["backticks inside frontmatter", "---\ndesc: |\n  ```ts\n  const x = 1\n  ```\n---\n# Title", "````yaml\ndesc: |\n  ```ts\n  const x = 1\n  ```\n````\n\n# Title"],
  ])("rewrites %s", (_, input, expected) => {
    expect(previewMarkdown(input)).toBe(expected)
  })

  test.each([
    ["plain markdown", "# Title\n\n---\n\nSection"],
    ["unclosed opening delimiter", "---\ndescription: Release\n# Title"],
    ["four-dash thematic break on line 1", "----\ndescription: Release\n---\n# Title"],
    ["four-dash line instead of closing delimiter", "---\ndescription: Release\n----\n# Title"],
    ["leading blank line before delimiter", "\n---\ndescription: Release\n---\n# Title"],
    ["delimiter after prose", "Intro\n---\ndescription: Release\n---\n# Title"],
  ])("leaves %s untouched", (_, input) => {
    expect(previewMarkdown(input)).toBe(input)
  })
})
