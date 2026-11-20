import { describe, expect, test } from "bun:test"
import { bytesFromContent, contentBytes, parseDelimited, resolveArtifactPath, splitFrontmatter } from "./artifact"

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

  test("uses explicit size on text content without re-encoding", () => {
    expect(contentBytes({ type: "text", content: "a,b\n1,2\n", size: 72_351_744, truncated: true })).toBe(72_351_744)
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
    expect(parsed.columns).toBe(2)
    expect(parsed.truncated).toBe(false)
    expect(parsed.total).toBe(3)
  })

  test("keeps rows up to the limit and counts the rest of a whole small file", () => {
    const exact = parseDelimited("a\tb\n1\t2\n\n\r\n", "\t", 2)
    expect(exact).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      columns: 2,
      truncated: false,
      total: 2,
    })

    const over = parseDelimited("a\tb\n1\t2\n3\t4\n5\t6", "\t", 2)
    expect(over).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      columns: 2,
      truncated: true,
      total: 4,
    })
  })

  test("drops incomplete trailing rows and unclosed quotes on byte-truncated previews", () => {
    expect(parseDelimited("a,b\n1,2\n3,part", ",", 100, { truncated: true })).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      columns: 2,
      truncated: true,
    })

    expect(parseDelimited('a,b\n1,2\n"unclosed\nline', ",", 100, { truncated: true })).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      columns: 2,
      truncated: true,
    })

    expect(parseDelimited("a,b\n1,2\n", ",", 100, { truncated: true })).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      columns: 2,
      truncated: true,
    })

    expect(parseDelimited("a,b,c", ",", 100, { truncated: true })).toEqual({
      rows: [["a", "b", "c"]],
      columns: 3,
      truncated: true,
    })
  })

  test("stops early on multi-megabyte delimited text once the row limit is reached", () => {
    const header = Array.from({ length: 22 }, (_, i) => `col_${i}`).join(",")
    const row = Array.from({ length: 22 }, (_, i) => `value_${i}_0123456789abcdef`).join(",")
    // ~20 MiB CSV (35,000 rows x 22 columns); without early stop this scans every character.
    const large = `${header}\n${`${row}\n`.repeat(35_000)}`

    const parsed = parseDelimited(large, ",", 1001)
    expect(parsed.rows).toHaveLength(1001)
    expect(parsed.columns).toBe(22)
    expect(parsed.truncated).toBe(true)
    expect(parsed.total).toBeUndefined()
    expect(parsed.rows[0]?.[0]).toBe("col_0")
    expect(parsed.rows[1000]?.[21]).toBe("value_21_0123456789abcdef")
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

describe("splitFrontmatter", () => {
  const release = [{ key: "description", value: "Release", code: false }]
  const primary = [{ key: "mode", value: "primary", code: false }]

  test.each([
    ["LF frontmatter and body", "---\ndescription: Release\n---\n# Title", { properties: release, body: "# Title" }],
    [
      "CRLF and UTF-8 BOM",
      "\uFEFF---\r\ndescription: Release\r\n---\r\n# Title\r\n",
      { properties: release, body: "# Title\r\n" },
    ],
    ["frontmatter at EOF", "---\nmode: primary\n---", { properties: primary, body: "" }],
    ["frontmatter with trailing blank lines only", "---\nmode: primary\n---\n\n", { properties: primary, body: "\n" }],
    [
      "empty frontmatter before a later thematic break",
      "---\n---\n\nBody\n\n---\n\nFooter",
      { body: "\nBody\n\n---\n\nFooter" },
    ],
    ["whitespace-only frontmatter", "---\n  \n---\n# Title", { body: "# Title" }],
  ])("splits %s", (_, input, expected) => {
    expect(splitFrontmatter(input)).toEqual(expected)
  })

  test("reads scalars, block scalars, and nested values", () => {
    const yaml = [
      "# reviewer agent",
      'description: "Reviews code"',
      "tools:",
      "  write: false",
      "  bash: false",
      "skills:",
      "- review",
      "prompt: |",
      "  Line one",
      "",
      "  Line two",
      "summary: >",
      "  Folded",
      "  text",
      "note: first",
      "  second",
      "empty:",
      "",
    ].join("\n")

    expect(splitFrontmatter(`---\n${yaml}\n---\nBody`).properties).toEqual([
      { key: "description", value: "Reviews code", code: false },
      { key: "tools", value: "write: false\nbash: false", code: true },
      { key: "skills", value: "- review", code: true },
      { key: "prompt", value: "Line one\n\nLine two", code: false },
      { key: "summary", value: "Folded text", code: false },
      { key: "note", value: "first second", code: false },
      { key: "empty", value: "", code: false },
    ])
  })

  test.each([
    ["a line that is not a key", "---\njust text\n---\n# Title", { body: "```yaml\njust text\n```\n\n# Title" }],
    ["a top-level list", "---\n- one\n- two\n---", { body: "```yaml\n- one\n- two\n```" }],
    [
      "backticks in unreadable frontmatter",
      "---\n- ```ts\n---\n# Title",
      { body: "````yaml\n- ```ts\n````\n\n# Title" },
    ],
  ])("keeps %s as a YAML block", (_, input, expected) => {
    expect(splitFrontmatter(input)).toEqual(expected)
  })

  test.each([
    ["a trailing comment", "temperature: 0.2 # lower"],
    ["a comment in a plain multi-line value", "note: first\n  second # more"],
    ["a comment after a block scalar indicator", "prompt: | # keep\n  Line"],
    ["an escaped double-quoted value", 'title: "a \\"b\\""'],
    ["an escaped single-quoted value", "title: 'it''s'"],
    ["a quoted value that wraps", 'description: "foo\n  bar"'],
    ["a quoted value followed by a comment", 'title: "a" # note'],
  ])("keeps %s as a YAML block", (_, yaml) => {
    expect(splitFrontmatter(`---\n${yaml}\n---\nBody`)).toEqual({ body: `\`\`\`yaml\n${yaml}\n\`\`\`\n\nBody` })
  })

  test("reads hashes that are not comments", () => {
    const yaml = ['title: "a # b"', "tag: C#", "summary: >", "  # not a comment", "prompt: |", "  # heading"].join("\n")

    expect(splitFrontmatter(`---\n${yaml}\n---\nBody`).properties).toEqual([
      { key: "title", value: "a # b", code: false },
      { key: "tag", value: "C#", code: false },
      { key: "summary", value: "# not a comment", code: false },
      { key: "prompt", value: "# heading", code: false },
    ])
  })

  test.each([
    ["plain markdown", "# Title\n\n---\n\nSection"],
    ["unclosed opening delimiter", "---\ndescription: Release\n# Title"],
    ["four-dash thematic break on line 1", "----\ndescription: Release\n---\n# Title"],
    ["four-dash line instead of closing delimiter", "---\ndescription: Release\n----\n# Title"],
    ["leading blank line before delimiter", "\n---\ndescription: Release\n---\n# Title"],
    ["delimiter after prose", "Intro\n---\ndescription: Release\n---\n# Title"],
  ])("leaves %s untouched", (_, input) => {
    expect(splitFrontmatter(input)).toEqual({ body: input })
  })
})
