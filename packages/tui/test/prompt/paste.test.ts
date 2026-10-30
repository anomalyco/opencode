import { describe, expect, test } from "bun:test"
import { pasteSummary } from "../../src/prompt/paste"

describe("pasteSummary", () => {
  test("defaults: three lines or more than 150 characters are summarized", () => {
    expect(pasteSummary("a\nb", undefined)).toBeUndefined()
    expect(pasteSummary("a\nb\nc", undefined)).toBe("[Pasted ~3 lines]")
    expect(pasteSummary("x".repeat(150), undefined)).toBeUndefined()
    expect(pasteSummary("x".repeat(151), undefined)).toBe("[Pasted ~1 lines]")
  })

  test("thresholds come from the config", () => {
    expect(pasteSummary("a\nb\nc", { lines: 4 })).toBeUndefined()
    expect(pasteSummary("a\nb", { lines: 2 })).toBe("[Pasted ~2 lines]")
    expect(pasteSummary("x".repeat(151), { characters: 1000 })).toBeUndefined()
    expect(pasteSummary("xx", { characters: 1 })).toBe("[Pasted ~1 lines]")
  })

  test("formats line, character and byte counts", () => {
    expect(pasteSummary("é\nb\nc", { format: "[{lines} lines, {characters} chars, {bytes} B]" })).toBe(
      "[3 lines, 5 chars, 6 B]",
    )
  })

  test("an excerpt flattens whitespace and cuts at the configured length", () => {
    const content = "first line\n\n  second   line\nthird"
    expect(pasteSummary(content, { format: "[Pasted: {excerpt}]" })).toBe("[Pasted: first line second line third]")
    expect(pasteSummary(content, { format: "[{excerpt}]", excerpt: 12 })).toBe("[first line s…]")
    expect(pasteSummary("😀😀😀\n\n", { format: "{excerpt}", excerpt: 2 })).toBe("😀😀…")
  })

  test("keeps the placeholder on one line", () => {
    expect(pasteSummary("a\nb\nc", { format: "[Pasted\n{lines}]" })).toBe("[Pasted 3]")
  })
})
