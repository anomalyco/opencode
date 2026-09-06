import { describe, expect, test } from "bun:test"
import {
  levenshtein,
  replace,
  trimDiff,
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
} from "../../src/tool/edit"

function collect(replacer: (content: string, find: string) => Generator<string>, content: string, find: string) {
  return Array.from(replacer(content, find))
}

describe("levenshtein", () => {
  test("identical strings have distance 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
  })

  test("empty vs non-empty returns length", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })

  test("both empty returns 0", () => {
    expect(levenshtein("", "")).toBe(0)
  })

  test("single character difference", () => {
    expect(levenshtein("a", "b")).toBe(1)
  })

  test("insertion", () => {
    expect(levenshtein("abc", "abcd")).toBe(1)
  })

  test("deletion", () => {
    expect(levenshtein("abcd", "abc")).toBe(1)
  })

  test("substitution", () => {
    expect(levenshtein("kitten", "sitten")).toBe(1)
  })

  test("classic kitten-sitting example", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
  })

  test("completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3)
  })

  test("is symmetric", () => {
    expect(levenshtein("foo", "bar")).toBe(levenshtein("bar", "foo"))
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"))
  })

  test("handles strings of very different lengths", () => {
    expect(levenshtein("a", "abcdef")).toBe(5)
    expect(levenshtein("abcdef", "a")).toBe(5)
  })
})

describe("replace", () => {
  test("exact match replacement", () => {
    expect(replace("hello world", "hello", "goodbye")).toBe("goodbye world")
  })

  test("throws when oldString not found", () => {
    expect(() => replace("hello world", "missing", "replacement")).toThrow("Could not find oldString")
  })

  test("throws when oldString equals newString", () => {
    expect(() => replace("hello", "hello", "hello")).toThrow("identical")
  })

  test("throws when oldString is empty", () => {
    expect(() => replace("hello", "", "new")).toThrow("oldString cannot be empty")
  })

  test("replaces first occurrence when multiple exist without replaceAll", () => {
    // Multiple exact matches without replaceAll should fail (unique match required)
    expect(() => replace("foo bar foo", "foo", "baz")).toThrow()
  })

  test("replaces all occurrences with replaceAll", () => {
    expect(replace("foo bar foo baz foo", "foo", "qux", true)).toBe("qux bar qux baz qux")
  })

  test("handles multiline content", () => {
    expect(replace("line1\nline2\nline3", "line2", "new line")).toBe("line1\nnew line\nline3")
  })

  test("falls through to fuzzy replacers on whitespace differences", () => {
    const content = "  hello  world  \n  foo  bar  "
    // LineTrimmedReplacer or WhitespaceNormalizedReplacer should handle trimmed match
    expect(replace(content, "hello  world", "goodbye world")).toBe("  goodbye world  \n  foo  bar  ")
  })
})

describe("trimDiff", () => {
  test("removes common leading whitespace from diff lines", () => {
    const diff = [
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,3 @@",
      "     unchanged",
      "-    old line",
      "+    new line",
      "     unchanged",
    ].join("\n")

    const result = trimDiff(diff)
    expect(result).not.toContain("     unchanged")
    // Should have reduced indentation
    expect(result).toContain("-old line")
    expect(result).toContain("+new line")
  })

  test("returns diff unchanged when no common whitespace", () => {
    const diff = ["--- a/file.ts", "+++ b/file.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n")
    expect(trimDiff(diff)).toBe(diff)
  })

  test("returns diff unchanged when no content lines", () => {
    const diff = "--- a/file\n+++ b/file\n"
    expect(trimDiff(diff)).toBe(diff)
  })
})

describe("SimpleReplacer", () => {
  test("yields the exact find string", () => {
    expect(collect(SimpleReplacer, "any content", "find")).toEqual(["find"])
  })
})

describe("LineTrimmedReplacer", () => {
  test("matches lines ignoring leading/trailing whitespace", () => {
    const content = "  hello world  \n  foo bar  "
    const matches = collect(LineTrimmedReplacer, content, "hello world")
    expect(matches.length).toBe(1)
    expect(matches[0]).toBe("  hello world  ")
  })

  test("matches multi-line blocks with trimmed lines", () => {
    const content = "  line1  \n  line2  \n  line3  "
    const matches = collect(LineTrimmedReplacer, content, "line1\nline2")
    expect(matches.length).toBe(1)
  })

  test("returns empty when no trimmed match", () => {
    expect(collect(LineTrimmedReplacer, "hello world", "not here")).toEqual([])
  })
})

describe("BlockAnchorReplacer", () => {
  test("requires at least 3 lines", () => {
    expect(collect(BlockAnchorReplacer, "a\nb", "a\nb")).toEqual([])
  })

  test("matches block with same first and last lines", () => {
    const content = "function foo() {\n  const x = 1\n  return x\n}"
    const find = "function foo() {\n  const x = 1\n  return x\n}"
    const matches = collect(BlockAnchorReplacer, content, find)
    expect(matches.length).toBe(1)
  })

  test("rejects blocks with unrelated middle content", () => {
    const content = "function foo() {\n  deleteEverything()\n}"
    const find = "function foo() {\n  const x = 1\n}"
    const matches = collect(BlockAnchorReplacer, content, find)
    expect(matches).toEqual([])
  })
})

describe("WhitespaceNormalizedReplacer", () => {
  test("matches with different internal whitespace", () => {
    const content = "hello   world   here"
    const matches = collect(WhitespaceNormalizedReplacer, content, "hello world here")
    expect(matches.length).toBeGreaterThan(0)
  })

  test("returns empty for no match", () => {
    expect(collect(WhitespaceNormalizedReplacer, "hello world", "not here")).toEqual([])
  })
})

describe("IndentationFlexibleReplacer", () => {
  test("matches blocks with different indentation levels", () => {
    const content = "    line1\n    line2"
    const matches = collect(IndentationFlexibleReplacer, content, "  line1\n  line2")
    expect(matches.length).toBe(1)
    expect(matches[0]).toBe("    line1\n    line2")
  })

  test("returns empty for content mismatch", () => {
    expect(collect(IndentationFlexibleReplacer, "  foo", "  bar")).toEqual([])
  })
})

describe("EscapeNormalizedReplacer", () => {
  test("matches unescaped version in content", () => {
    const content = 'line with "quotes"'
    const matches = collect(EscapeNormalizedReplacer, content, 'line with \\"quotes\\"')
    expect(matches.length).toBeGreaterThan(0)
  })
})

describe("TrimmedBoundaryReplacer", () => {
  test("matches trimmed version of find in content", () => {
    const content = "hello world"
    const matches = collect(TrimmedBoundaryReplacer, content, "  hello world  ")
    // Yields both a direct substring match and a block-level trimmed match
    expect(matches.length).toBe(2)
    expect(matches[0]).toBe("hello world")
    expect(matches[1]).toBe("hello world")
  })

  test("skips when find is already trimmed", () => {
    expect(collect(TrimmedBoundaryReplacer, "hello", "hello")).toEqual([])
  })
})

describe("ContextAwareReplacer", () => {
  test("requires at least 3 lines", () => {
    expect(collect(ContextAwareReplacer, "a\nb", "a\nb")).toEqual([])
  })

  test("matches context-anchored blocks", () => {
    const content = "start\n  middle\nend\nother"
    const find = "start\n  middle\nend"
    const matches = collect(ContextAwareReplacer, content, find)
    expect(matches.length).toBe(1)
    expect(matches[0]).toBe("start\n  middle\nend")
  })
})

describe("MultiOccurrenceReplacer", () => {
  test("yields all exact occurrences", () => {
    const matches = collect(MultiOccurrenceReplacer, "foo bar foo baz foo", "foo")
    expect(matches.length).toBe(3)
    expect(matches).toEqual(["foo", "foo", "foo"])
  })

  test("returns empty for no match", () => {
    expect(collect(MultiOccurrenceReplacer, "hello", "xyz")).toEqual([])
  })
})
