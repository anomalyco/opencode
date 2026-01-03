import { describe, test, expect } from "bun:test"
import {
  isWordChar,
  getWordBoundaries,
  lowercaseWord,
  uppercaseWord,
  capitalizeWord,
} from "../../src/cli/cmd/tui/component/prompt/word"

describe("isWordChar", () => {
  test("letters are word chars", () => {
    expect(isWordChar("a")).toBe(true)
    expect(isWordChar("Z")).toBe(true)
  })

  test("digits are word chars", () => {
    expect(isWordChar("0")).toBe(true)
    expect(isWordChar("9")).toBe(true)
  })

  test("underscore is NOT a word char (matches Readline/Emacs)", () => {
    expect(isWordChar("_")).toBe(false)
  })

  test("punctuation is not a word char", () => {
    expect(isWordChar("-")).toBe(false)
    expect(isWordChar(".")).toBe(false)
    expect(isWordChar(" ")).toBe(false)
  })
})

describe("getWordBoundaries", () => {
  // Basic cases
  test("cursor inside word: transforms from cursor to end of word", () => {
    expect(getWordBoundaries("hello world", 3)).toEqual({ start: 3, end: 5 })
  })

  test("cursor at start of word: transforms full word", () => {
    expect(getWordBoundaries("hello world", 6)).toEqual({ start: 6, end: 11 })
  })

  test("cursor on space: skips to next word", () => {
    expect(getWordBoundaries("hello world", 5)).toEqual({ start: 6, end: 11 })
  })

  test("cursor on multiple spaces: skips to next word", () => {
    expect(getWordBoundaries("hello   world", 5)).toEqual({ start: 8, end: 13 })
  })

  test("empty string returns null", () => {
    expect(getWordBoundaries("", 0)).toBeNull()
  })

  test("cursor at end of text falls back to previous word", () => {
    expect(getWordBoundaries("hello world", 11)).toEqual({ start: 6, end: 11 })
  })

  test("cursor past end falls back to previous word", () => {
    expect(getWordBoundaries("hello world", 12)).toEqual({ start: 6, end: 11 })
  })

  test("cursor on trailing space falls back to previous word", () => {
    expect(getWordBoundaries("hello world ", 12)).toEqual({ start: 6, end: 11 })
  })

  test("cursor past trailing punctuation falls back to previous word", () => {
    expect(getWordBoundaries("MERGED-BRANCHES.", 16)).toEqual({ start: 7, end: 15 })
  })

  // Punctuation as word boundaries (the ariane-emory bug report)
  test("hyphen is a word boundary: first alt+u on 'merged-branches.md' finds only 'merged'", () => {
    expect(getWordBoundaries("merged-branches.md", 0)).toEqual({ start: 0, end: 6 })
  })

  test("cursor on hyphen: skips to 'branches', not 'branches.md'", () => {
    expect(getWordBoundaries("MERGED-branches.md", 6)).toEqual({ start: 7, end: 15 })
  })

  test("dot is a word boundary: cursor on '.' finds 'md'", () => {
    expect(getWordBoundaries("MERGED-BRANCHES.md", 15)).toEqual({ start: 16, end: 18 })
  })

  test("cursor on '-': skips to next word", () => {
    expect(getWordBoundaries("foo-bar", 3)).toEqual({ start: 4, end: 7 })
  })

  // Underscore is NOT a word char
  test("underscore is a word boundary: 'foo_bar' from 0 finds only 'foo'", () => {
    expect(getWordBoundaries("foo_bar", 0)).toEqual({ start: 0, end: 3 })
  })

  test("underscore is a word boundary: cursor on '_' finds 'bar'", () => {
    expect(getWordBoundaries("foo_bar", 3)).toEqual({ start: 4, end: 7 })
  })

  // Digits
  test("digits are word chars: 'foo123' is one word", () => {
    expect(getWordBoundaries("foo123 bar", 0)).toEqual({ start: 0, end: 6 })
  })
})

describe("uppercaseWord integration", () => {
  test("first alt+u on 'merged-branches.md' upcases only 'merged'", () => {
    const bounds = getWordBoundaries("merged-branches.md", 0)!
    expect(bounds).toEqual({ start: 0, end: 6 })
    expect(uppercaseWord("merged-branches.md", bounds.start, bounds.end)).toBe("MERGED-branches.md")
  })

  test("second alt+u (cursor on '-') upcases only 'branches'", () => {
    const bounds = getWordBoundaries("MERGED-branches.md", 6)!
    expect(bounds).toEqual({ start: 7, end: 15 })
    expect(uppercaseWord("MERGED-branches.md", bounds.start, bounds.end)).toBe("MERGED-BRANCHES.md")
  })

  test("third alt+u (cursor on '.') upcases only 'md'", () => {
    const bounds = getWordBoundaries("MERGED-BRANCHES.md", 15)!
    expect(bounds).toEqual({ start: 16, end: 18 })
    expect(uppercaseWord("MERGED-BRANCHES.md", bounds.start, bounds.end)).toBe("MERGED-BRANCHES.MD")
  })

  test("alt+u at end of buffer falls back to previous word", () => {
    expect(getWordBoundaries("hello world", 11)).toEqual({ start: 6, end: 11 })
  })
})

describe("lowercaseWord", () => {
  test("lowercases word in range", () => {
    expect(lowercaseWord("HELLO world", 0, 5)).toBe("hello world")
  })

  test("lowercases partial word from cursor", () => {
    expect(lowercaseWord("HELLO world", 2, 5)).toBe("HEllo world")
  })

  test("empty range is a no-op", () => {
    expect(lowercaseWord("hello world", 3, 3)).toBe("hello world")
  })
})

describe("uppercaseWord", () => {
  test("uppercases word in range", () => {
    expect(uppercaseWord("hello world", 6, 11)).toBe("hello WORLD")
  })

  test("uppercases partial word from cursor", () => {
    expect(uppercaseWord("hello world", 6, 9)).toBe("hello WORld")
  })
})

describe("capitalizeWord", () => {
  test("capitalizes word (first char up, rest down)", () => {
    expect(capitalizeWord("hello WORLD", 6, 11)).toBe("hello World")
  })

  test("capitalizes mixed-case word", () => {
    expect(capitalizeWord("hello hElLo", 6, 11)).toBe("hello Hello")
  })

  test("only upcases first letter", () => {
    expect(capitalizeWord("hello WORLD", 0, 5)).toBe("Hello WORLD")
  })
})
