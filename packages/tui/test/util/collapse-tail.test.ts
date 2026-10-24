import { expect, test } from "bun:test"
import { collapseHeadTail, collapseTail } from "../../src/util/collapse-tool-output"
import { collapseOutput } from "../../src/routes/session"

const output = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n")

test("collapseTail keeps v2's label and last lines", () => {
  expect(collapseTail(output, 4, 1000)).toBe("(27 earlier lines)\nline 28\nline 29\nline 30")
  expect(collapseTail("a\nb", 4, 1000)).toBe("a\nb")
  expect(collapseTail(output, 1, 1000)).toBe("(30 earlier lines)")
  expect(collapseTail("a\nb", 1, 1000)).toBe("(2 earlier lines)")
})

test("collapseOutput shows the head by default and the tail when asked", () => {
  expect(collapseOutput(output, 3, 80).output).toBe("line 1\nline 2\nline 3\n…")
  expect(collapseOutput(output, 3, 80, true)).toEqual({
    output: "(28 earlier lines)\nline 29\nline 30",
    overflow: true,
  })
  expect(collapseOutput("short", 3, 80, true)).toEqual({ output: "short", overflow: false })
  expect(collapseOutput(output, 0, 80, true)).toEqual({ output: "", overflow: true })
  expect(collapseOutput(output, undefined, 80, true)).toEqual({ output, overflow: false })
})

test("collapseHeadTail keeps the first lines, a marker and the last lines in the limit", () => {
  expect(collapseHeadTail(output, 2, 5, 1000)).toBe("line 1\nline 2\n(26 more lines)\nline 29\nline 30")
  expect(collapseHeadTail(output, 10, 5, 1000)).toBe("line 1\nline 2\nline 3\n(26 more lines)\nline 30")
  expect(collapseHeadTail("a\nb\nc\nd\ne\nf", 2, 5, 1000)).toBe("a\nb\n(2 more lines)\ne\nf")
  expect(collapseHeadTail(`a\nb\n${"c".repeat(200)}\nd\ne`, 2, 5, 100)).toBe("a\nb\n(1 more line)\nd\ne")
  expect(collapseHeadTail("a\nb\nc", 2, 5, 1000)).toBe("a\nb\nc")
})

test("collapseHeadTail is v2's collapseTail without room for a head or a whole line to hide", () => {
  expect(collapseHeadTail(output, 0, 5, 1000)).toBe(collapseTail(output, 5, 1000))
  expect(collapseHeadTail(output, 2, 2, 1000)).toBe(collapseTail(output, 2, 1000))
  const long = `${"x".repeat(50)}\n${"y".repeat(50)}`
  expect(collapseHeadTail(long, 1, 3, 60)).toBe(collapseTail(long, 3, 60))
})

test("collapseHeadTail caps each part at its lines' share of characters", () => {
  const wide = [..."abcdef"].map((letter) => letter.repeat(30)).join("\n")
  expect(collapseHeadTail(wide, 1, 3, 30)).toBe(`${"a".repeat(9)}…\n(4 more lines)\n${"f".repeat(10)}`)
})

test("collapseOutput keeps a head above the tail, and 0 still hides the output", () => {
  expect(collapseOutput(output, 5, 80, true, 2)).toEqual({
    output: "line 1\nline 2\n(26 more lines)\nline 29\nline 30",
    overflow: true,
  })
  expect(collapseOutput(output, 5, 80, false, 2).output).toBe("line 1\nline 2\nline 3\nline 4\nline 5\n…")
  expect(collapseOutput(output, 0, 80, true, 2)).toEqual({ output: "", overflow: true })
  expect(collapseOutput("a\nb\nc\nd\ne", 5, 80, true, 2)).toEqual({ output: "a\nb\nc\nd\ne", overflow: false })
})
