import { describe, expect, test } from "bun:test"
import {
  PREVIEW_MAX_LENGTH,
  PREVIEW_MAX_ROWS,
  PREVIEW_MIN_PANE,
  PREVIEW_MIN_ROWS,
  PREVIEW_MIN_TERM_WIDTH,
  PREVIEW_TRUNCATED,
  normalizeOptions,
  normalizePreview,
  previewLayout,
  previewLines,
} from "../src/question"

const ESC = String.fromCharCode(27)

describe("normalizePreview", () => {
  test("passes plain monospace content through verbatim", () => {
    const text = "root/\n  src/\n    index.ts"
    expect(normalizePreview(text)).toBe(text)
  })

  test("strips fence markers and keeps the inner content", () => {
    expect(normalizePreview("```ts\nconst a = 1\n```")).toBe("const a = 1")
    expect(normalizePreview("~~~\nplain\n~~~")).toBe("plain")
  })

  test("strips ANSI escapes and control characters", () => {
    expect(normalizePreview(`${ESC}[31mred${ESC}[0m`)).toBe("red")
    expect(normalizePreview(`a${String.fromCharCode(7)}b`)).toBe("ab")
  })

  test("expands tabs so columns stay stable in fixed-width panes", () => {
    expect(normalizePreview("a\tb")).toBe("a  b")
  })

  test("treats non-strings and blank content as absent", () => {
    expect(normalizePreview(undefined)).toBeUndefined()
    expect(normalizePreview(null)).toBeUndefined()
    expect(normalizePreview(42)).toBeUndefined()
    expect(normalizePreview("")).toBeUndefined()
    expect(normalizePreview("   \n\n  ")).toBeUndefined()
    expect(normalizePreview("```\n```")).toBeUndefined()
  })

  test("truncates oversized content instead of throwing", () => {
    const result = normalizePreview("x".repeat(PREVIEW_MAX_LENGTH * 3))
    expect(result).toBeDefined()
    expect(result!.endsWith(PREVIEW_TRUNCATED)).toBe(true)
    expect(result!.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH + PREVIEW_TRUNCATED.length + 1)
  })

  test("leaves content at exactly the cap untouched", () => {
    const text = "y".repeat(PREVIEW_MAX_LENGTH)
    expect(normalizePreview(text)).toBe(text)
  })
})

type Opt = { label: string; description: string; preview?: string }
const opts = (...items: Opt[]): Opt[] => items

describe("normalizeOptions", () => {
  test("round-trips a preview for single-select questions", () => {
    expect(normalizeOptions(opts({ label: "A", description: "a", preview: "col1 col2" }), undefined)).toEqual(
      opts({ label: "A", description: "a", preview: "col1 col2" }),
    )
    expect(normalizeOptions(opts({ label: "A", description: "a", preview: "keep" }), false)).toEqual(
      opts({ label: "A", description: "a", preview: "keep" }),
    )
  })

  test("drops previews when the question is multi-select", () => {
    const result = normalizeOptions(opts({ label: "A", description: "a", preview: "ignored" }), true)
    expect(result).toEqual(opts({ label: "A", description: "a" }))
    expect("preview" in result[0]).toBe(false)
  })

  test("drops previews that normalize to nothing", () => {
    const result = normalizeOptions(opts({ label: "A", description: "a", preview: "```\n```" }), false)
    expect("preview" in result[0]).toBe(false)
  })

  test("returns the original array untouched when no option carries a preview", () => {
    const options = opts({ label: "A", description: "a" })
    expect(normalizeOptions(options, false)).toBe(options)
    expect(normalizeOptions(options, true)).toBe(options)
  })
})

describe("previewLayout", () => {
  const wide = { width: 140, height: 45 }
  const narrow = { width: 60, height: 45 }

  test("stays single-column when no option carries a preview", () => {
    expect(previewLayout({ ...wide, previewed: false }).twoPane).toBe(false)
    expect(previewLayout({ ...narrow, previewed: false }).twoPane).toBe(false)
  })

  test("engages the two-pane layout only on a wide enough terminal", () => {
    expect(previewLayout({ ...wide, previewed: true }).twoPane).toBe(true)
    expect(previewLayout({ ...narrow, previewed: true }).twoPane).toBe(false)
    expect(previewLayout({ width: PREVIEW_MIN_TERM_WIDTH - 1, height: 45, previewed: true }).twoPane).toBe(false)
    expect(previewLayout({ width: PREVIEW_MIN_TERM_WIDTH, height: 45, previewed: true }).twoPane).toBe(true)
  })

  test("keeps both columns usable and inside the content width", () => {
    const layout = previewLayout({ ...wide, previewed: true })
    expect(layout.listWidth).toBeGreaterThanOrEqual(PREVIEW_MIN_PANE)
    expect(layout.previewWidth).toBeGreaterThanOrEqual(PREVIEW_MIN_PANE)
    expect(layout.listWidth + layout.previewWidth + 4).toBeLessThanOrEqual(wide.width - 6)
  })

  test("bounds pane height by the terminal, never by the content", () => {
    expect(previewLayout({ width: 140, height: 9, previewed: true }).rows).toBe(PREVIEW_MIN_ROWS)
    expect(previewLayout({ width: 140, height: 400, previewed: true }).rows).toBe(PREVIEW_MAX_ROWS)
    expect(previewLayout({ width: 140, height: 24, previewed: true }).rows).toBe(8)
  })
})

describe("previewLines", () => {
  test("clips long lines rather than wrapping them", () => {
    expect(previewLines("abcdefghij", 5, 10)).toEqual(["abcd›"])
  })

  test("keeps content that already fits", () => {
    expect(previewLines("ab\ncd", 10, 10)).toEqual(["ab", "cd"])
  })

  test("bounds row count and reports what was hidden", () => {
    const lines = previewLines("1\n2\n3\n4\n5", 20, 3)
    expect(lines).toHaveLength(3)
    expect(lines).toEqual(["1", "2", "… 3 more lines"])
  })

  test("never exceeds the row budget at the boundary", () => {
    expect(previewLines("1\n2\n3", 20, 3)).toEqual(["1", "2", "3"])
    expect(previewLines("1\n2\n3\n4", 20, 3)).toEqual(["1", "2", "… 2 more lines"])
    expect(previewLines("1\n2\n3", 20, 2)).toEqual(["1", "… 2 more lines"])
  })
})
