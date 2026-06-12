import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  COLUMNS,
  dimensions,
  language,
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

describe("dimensions", () => {
  test("stays inside the strictest vision budget", () => {
    for (const max of [1, 999, 99999, 9999999]) {
      const dim = dimensions(max)
      expect(Math.max(dim.width, dim.height)).toBeLessThanOrEqual(LIMIT)
      expect(Math.ceil(dim.width / PATCH) * Math.ceil(dim.height / PATCH)).toBeLessThanOrEqual(LIMIT)
      expect(dim.rows).toBeGreaterThan(50)
    }
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
    const lines = Array.from({ length: 250 }, (_, index) =>
      index % 10 === 0
        ? `\texport const value${index} = { nested: "<tag> & 'quote' é→" } // ${"x".repeat(140)}`
        : `const item${index} = compute(${index}) // item ${index}`,
    )
    const pages = await Effect.runPromise(
      render({ path: "packages/example/src/sample.ts", filepath: "/tmp/sample.ts", lines, offset: 1, total: 250 }),
    )
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]!.start).toBe(1)
    expect(pages.at(-1)!.end).toBe(250)
    const dim = dimensions(250)
    for (const [index, page] of pages.entries()) {
      if (index > 0) expect(page.start).toBe(pages[index - 1]!.end + 1)
      const image = png(page.url)
      expect(image.width).toBe(dim.width)
      expect(image.height).toBeLessThanOrEqual(dim.height)
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(LIMIT)
      expect(Math.ceil(image.width / PATCH) * Math.ceil(image.height / PATCH)).toBeLessThanOrEqual(LIMIT)
    }
  }, 30000)
})
