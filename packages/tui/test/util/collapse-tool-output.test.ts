import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "../../src/util/collapse-tool-output"

describe("collapseToolOutput", () => {
  test.each([
    ["short output", "hello", 3, 10, { output: "hello", overflow: false }],
    ["empty output", "", 3, 10, { output: "", overflow: false }],
    ["character limit", "abcdef", 3, 4, { output: "abc…", overflow: true }],
    ["zero character limit", "a", 3, 0, { output: "…", overflow: true }],
    ["emoji code points", "😀😀😀", 3, 2, { output: "😀…", overflow: true }],
    ["combining code points", "e\u0301x", 3, 2, { output: "e…", overflow: true }],
    ["line limit", "a\nb\nc", 2, 20, { output: "a\nb\n…", overflow: true }],
    ["character limit before line limit", "abcd\nrest", 1, 3, { output: "ab…", overflow: true }],
    ["line limit at exact character limit", "abc\nrest", 1, 3, { output: "abc\n…", overflow: true }],
    ["trailing newline", "a\n", 1, 20, { output: "a\n…", overflow: true }],
    ["CRLF line", "a\r\nb", 1, 20, { output: "a\r\n…", overflow: true }],
    ["zero line limit", "a", 0, 20, { output: "…", overflow: true }],
    ["fractional line limit", "a\nb", 1.5, 20, { output: "a\n…", overflow: true }],
    ["negative line limit", "a\nb\nc", -1, 20, { output: "a\nb\n…", overflow: true }],
    ["NaN character limit", "ab", 3, Number.NaN, { output: "ab\n…", overflow: true }],
  ])("handles %s", (_name, output, maxLines, maxChars, expected) => {
    expect(collapseToolOutput(output as string, maxLines as number, maxChars as number)).toEqual(expected)
  })
})
