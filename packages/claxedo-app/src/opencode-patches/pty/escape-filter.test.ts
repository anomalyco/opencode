import { describe, expect, test } from "bun:test"
import { containsClearScrollbackSequence, extractContentAfterClear } from "./escape-filter"

describe("containsClearScrollbackSequence", () => {
  test("detects ED3 alone", () => {
    expect(containsClearScrollbackSequence("\x1b[3J")).toBe(true)
  })

  test("detects ED3 within surrounding content", () => {
    expect(containsClearScrollbackSequence("before\x1b[3Jafter")).toBe(true)
  })

  test("detects ED3 at start of string", () => {
    expect(containsClearScrollbackSequence("\x1b[3Jcontent")).toBe(true)
  })

  test("detects ED3 at end of string", () => {
    expect(containsClearScrollbackSequence("content\x1b[3J")).toBe(true)
  })

  test("rejects RIS (not treated as clear scrollback)", () => {
    expect(containsClearScrollbackSequence("\x1bc")).toBe(false)
  })

  test("rejects similar but incomplete sequence \\x1b[3", () => {
    expect(containsClearScrollbackSequence("\x1b[3")).toBe(false)
  })

  test("rejects ED2 (clear screen, not scrollback)", () => {
    expect(containsClearScrollbackSequence("\x1b[2J")).toBe(false)
  })

  test("rejects plain text containing '3J'", () => {
    expect(containsClearScrollbackSequence("3J")).toBe(false)
  })

  test("rejects empty string", () => {
    expect(containsClearScrollbackSequence("")).toBe(false)
  })

  test("detects multiple ED3 sequences", () => {
    expect(containsClearScrollbackSequence("\x1b[3J\x1b[3J")).toBe(true)
  })
})

describe("extractContentAfterClear", () => {
  test("returns content after ED3", () => {
    expect(extractContentAfterClear("before\x1b[3Jafter")).toBe("after")
  })

  test("returns empty string when ED3 is at end", () => {
    expect(extractContentAfterClear("content\x1b[3J")).toBe("")
  })

  test("uses last ED3 when multiple exist", () => {
    expect(extractContentAfterClear("a\x1b[3Jb\x1b[3Jc")).toBe("c")
  })

  test("returns original data when no ED3 present", () => {
    expect(extractContentAfterClear("no clear here")).toBe("no clear here")
  })

  test("handles ED3 + ANSI colors after clear", () => {
    const result = extractContentAfterClear("old\x1b[3J\x1b[32mgreen\x1b[0m")
    expect(result).toBe("\x1b[32mgreen\x1b[0m")
  })

  test("handles ED3 + Unicode content after clear", () => {
    expect(extractContentAfterClear("old\x1b[3J日本語テスト")).toBe("日本語テスト")
  })

  test("handles ED3 + newlines after clear", () => {
    expect(extractContentAfterClear("old\x1b[3Jline1\r\nline2")).toBe("line1\r\nline2")
  })

  test("handles ED3 alone (no surrounding content)", () => {
    expect(extractContentAfterClear("\x1b[3J")).toBe("")
  })

  test("mixed ED3 + RIS (only ED3 triggers extraction)", () => {
    // RIS is \x1bc — should not affect extraction
    expect(extractContentAfterClear("\x1bcbefore\x1b[3Jafter")).toBe("after")
  })

  test("returns empty string for empty input", () => {
    expect(extractContentAfterClear("")).toBe("")
  })
})
