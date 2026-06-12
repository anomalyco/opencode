import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  COLUMNS,
  dimensions,
  language,
  pageColumns,
  paginate,
  render,
  supports,
} from "../../src/tool/read-screenshot/read-screenshot"

// Provider vision budget the renderer promises to stay inside: 1568px on the
// long edge and 1568 visual tokens of ceil(w/28) * ceil(h/28).
const PATCH = 28
const LIMIT = 1568

function plain(text: string) {
  return [{ content: text }]
}

function png(url: string) {
  expect(url.startsWith("data:image/png;base64,")).toBe(true)
  const buffer = Buffer.from(url.slice("data:image/png;base64,".length), "base64")
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe("supports", () => {
  test("targets gpt-5.5 and fable only", () => {
    expect(supports("gpt-5.5")).toBe(true)
    expect(supports("gpt-5.5-codex")).toBe(true)
    expect(supports("claude-fable-5")).toBe(true)
    expect(supports("gpt-5.1")).toBe(false)
    expect(supports("claude-sonnet-4-6")).toBe(false)
    expect(supports("gemini-3-pro")).toBe(false)
  })
})

describe("language", () => {
  test("maps extensions and special filenames", () => {
    expect(language("/a/b/read.ts")).toBe("typescript")
    expect(language("/a/b/main.go")).toBe("go")
    expect(language("/a/b/Dockerfile")).toBe("docker")
    expect(language("/a/b/notes.unknown")).toBeUndefined()
  })
})

describe("pageColumns", () => {
  test("tracks the widest row within bounds", () => {
    expect(pageColumns(paginate([plain("short"), plain("x".repeat(80))], 1)[0]!)).toBe(80)
    expect(pageColumns(paginate([plain("tiny")], 1)[0]!)).toBe(60)
    expect(pageColumns(paginate([plain("z".repeat(400))], 1)[0]!)).toBe(COLUMNS)
  })
})

describe("dimensions", () => {
  test("stays inside the strictest vision budget", () => {
    for (const max of [1, 999, 99999, 9999999]) {
      for (const cols of [60, 80, 100, 120]) {
        const dim = dimensions(max, cols)
        expect(Math.max(dim.width, dim.height)).toBeLessThanOrEqual(LIMIT)
        expect(Math.ceil(dim.width / PATCH) * Math.ceil(dim.height / PATCH)).toBeLessThanOrEqual(LIMIT)
        expect(dim.rows).toBeGreaterThan(80)
      }
    }
  })

  test("narrow content produces narrower pages", () => {
    expect(dimensions(100, 60).width).toBeLessThan(dimensions(100, 120).width)
  })
})

describe("paginate", () => {
  test("fills pages and keeps numbering continuous", () => {
    const capacity = dimensions(300).rows
    const pages = paginate(
      Array.from({ length: 300 }, (_, index) => plain(`line ${index + 1}`)),
      1,
    )
    expect(pages.length).toBe(Math.ceil(300 / capacity))
    expect(pages[0]!.start).toBe(1)
    expect(pages.at(-1)!.end).toBe(300)
    for (const [index, page] of pages.entries()) {
      expect(page.rows.length).toBeLessThanOrEqual(capacity)
      if (index > 0) expect(page.start).toBe(pages[index - 1]!.end + 1)
    }
  })

  test("wraps long lines onto unnumbered rows", () => {
    const pages = paginate([plain("x".repeat(COLUMNS * 4 + 20))], 7)
    expect(pages.length).toBe(1)
    expect(pages[0]!.rows.length).toBe(5)
    expect(pages[0]!.rows[0]!.line).toBe(7)
    expect(pages[0]!.rows.slice(1).every((row) => row.line === undefined)).toBe(true)
    const widths = pages[0]!.rows.map((row) => row.tokens.map((token) => token.content).join("").length)
    expect(widths).toEqual([COLUMNS, COLUMNS, COLUMNS, COLUMNS, 20])
  })

  test("wrapped lines never shift file numbering", () => {
    const lines = Array.from({ length: 400 }, (_, index) =>
      index % 7 === 0 ? plain("w".repeat(COLUMNS * 2 + 15)) : plain(`line ${index}`),
    )
    const pages = paginate(lines, 21)
    const numbers = pages.flatMap((page) => page.rows.flatMap((row) => row.line ?? []))
    expect(numbers).toEqual(Array.from({ length: 400 }, (_, index) => index + 21))
    expect(pages.at(-1)!.end).toBe(420)
  })

  test("wraps at the adaptive column width", () => {
    const pages = paginate([plain("x".repeat(75))], 1, 60)
    expect(pages[0]!.rows.length).toBe(2)
    const widths = pages[0]!.rows.map((row) => row.tokens.map((token) => token.content).join("").length)
    expect(widths).toEqual([60, 15])
  })

  test("starts every page on a numbered row", () => {
    const capacity = dimensions(200).rows
    const lines = [
      ...Array.from({ length: capacity - 1 }, (_, index) => plain(`short ${index}`)),
      plain("y".repeat(COLUMNS * 3)),
    ]
    const pages = paginate(lines, 1)
    expect(pages.length).toBe(2)
    expect(pages[0]!.rows.length).toBe(capacity - 1)
    expect(pages[1]!.rows[0]!.line).toBe(capacity)
  })

  test("numbers rows from the offset", () => {
    const pages = paginate([plain("a"), plain("b")], 500)
    expect(pages[0]!.start).toBe(500)
    expect(pages[0]!.end).toBe(501)
  })
})

describe("render", () => {
  test("produces in-budget png pages with continuous coverage", async () => {
    const lines = Array.from({ length: 350 }, (_, index) =>
      index % 10 === 0
        ? `\texport const value${index} = { nested: "<tag> & 'quote' é→" } // ${"x".repeat(140)}`
        : `const item${index} = compute(${index}) // item ${index}`,
    )
    const pages = await Effect.runPromise(
      render({ path: "packages/example/src/sample.ts", filepath: "/tmp/sample.ts", lines, offset: 1, total: 350 }),
    )
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]!.start).toBe(1)
    expect(pages.at(-1)!.end).toBe(350)
    const dim = dimensions(350, COLUMNS)
    for (const [index, page] of pages.entries()) {
      if (index > 0) expect(page.start).toBe(pages[index - 1]!.end + 1)
      const image = png(page.url)
      expect(image.width).toBe(dim.width)
      expect(image.height).toBeLessThanOrEqual(dim.height)
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(LIMIT)
      expect(Math.ceil(image.width / PATCH) * Math.ceil(image.height / PATCH)).toBeLessThanOrEqual(LIMIT)
    }
  }, 30000)

  test("page width adapts to narrow files", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `let v${index} = ${index}`)
    const pages = await Effect.runPromise(
      render({ path: "a.ts", filepath: "/x/a.ts", lines, offset: 1, total: 40 }),
    )
    expect(pages.length).toBe(1)
    expect(png(pages[0]!.url).width).toBe(dimensions(40, 60).width)
  }, 30000)

  test("each page is only as wide as its own content", async () => {
    const capacity = dimensions(200, COLUMNS).rows
    const lines = [
      ...Array.from({ length: capacity }, () => `// ${"x".repeat(92)}`),
      ...Array.from({ length: 30 }, (_, index) => `let n${index} = ${index}`),
    ]
    const pages = await Effect.runPromise(
      render({ path: "b.ts", filepath: "/x/b.ts", lines, offset: 1, total: lines.length }),
    )
    expect(pages.length).toBe(2)
    expect(png(pages[0]!.url).width).toBe(dimensions(lines.length, 95).width)
    expect(png(pages[1]!.url).width).toBe(dimensions(lines.length, 60).width)
  }, 30000)
})
