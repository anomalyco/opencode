import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "../../src/util/collapse-tool-output"

describe("collapseToolOutput", () => {
  test("returns short output untouched", () => {
    expect(collapseToolOutput("abc", 10, 100)).toEqual({ output: "abc", overflow: false })
  })

  test("counts astral characters as one code point", () => {
    const emoji = "😀".repeat(60)
    expect(Array.from(collapseToolOutput(emoji, 10, 100).output).length).toBeLessThanOrEqual(100)
  })

  test("honours maxChars when the preview is longer", () => {
    const result = collapseToolOutput("abcdefghij", 1, 5)
    expect(result.overflow).toBe(true)
    expect(Array.from(result.output).length).toBeLessThanOrEqual(5)
  })

  test("honours a zero maxChars bound", () => {
    const result = collapseToolOutput("abc", 10, 0)
    expect(result).toEqual({ output: "…", overflow: true })
  })

  test("appends an ellipsis line when only the line bound is exceeded", () => {
    const result = collapseToolOutput("a\nb\nc", 2, 100)
    expect(result).toEqual({ output: "a\nb\n…", overflow: true })
  })
})
