import { describe, expect, test } from "bun:test"
import { calculateRanges, DiffRange } from "../src/format/diff-range"

const expectRange = (old: string, next: string, start: number, end: number, byteStart?: number, byteEnd?: number) => {
  const ranges = calculateRanges(old, next)
  expect(ranges.length).toBe(1)
  expect(ranges[0]!.start).toBe(start)
  expect(ranges[0]!.end).toBe(end)
  if (byteStart != null) expect(ranges[0]!.byteStart).toBe(byteStart)
  if (byteEnd != null) expect(ranges[0]!.byteEnd).toBe(byteEnd)
}

describe("calculateRanges", () => {
  test("added lines", () => expectRange("line1\nline2\nline3", "line1\nline2\nnewline\nline3", 12, 20, 12, 20))

  test("multiple added lines", () =>
    expectRange("line1\nline2\nline3", "line1\nline2\nnewline1\nnewline2\nnewline3\nline3", 12, 39, 12, 39))

  test("removed lines", () => expectRange("line1\nline2\nline3\nline4", "line1\nline2\nline4", 12, 12, 12, 12))

  test("removed lines at end", () => expectRange("line1\nline2\nline3", "line1\nline2", 6, 11, 6, 11))

  test("merges adjacent ranges", () =>
    expectRange("line1\nline2\nline3\nline4\nline5", "line1\nnew2\nline3\nnew4\nline5", 6, 22, 6, 22))

  test("keeps separate ranges", () => {
    const ranges = calculateRanges("line1\nline2\nline3\nline4\nline5\nline6", "line1\nnew2\nline3\nline4\nline5\nnew6")
    expect(ranges.length).toBe(2)
    expect(ranges[0]!.start).toBe(6)
    expect(ranges[0]!.end).toBe(11)
    expect(ranges[1]!.start).toBe(29)
    expect(ranges[1]!.end).toBe(33)
  })

  test("empty old content", () => expectRange("", "line1\nline2\nline3", 0, 17, 0, 17))

  test("complex edit", () =>
    expectRange("line1\nline2\nline3\nline4\nline5", "line1\nnewA\nnewB\nline4\nline5", 6, 16, 6, 16))

  test("adding at beginning", () => expectRange("line2\nline3", "line1\nline2\nline3", 0, 6, 0, 6))

  test("adding at end", () => expectRange("line1\nline2\n", "line1\nline2\nline3\n", 12, 18, 12, 18))

  test("identical content returns empty", () => {
    const content = "line1\nline2\nline3"
    expect(calculateRanges(content, content)).toEqual([])
  })

  test("ignores line ending differences", () => {
    expect(calculateRanges("line1\r\nline2\r\nline3", "line1\nline2\nline3")).toEqual([])
  })

  test("unicode accuracy", () => {
    const ranges = calculateRanges("hello\nworld", "hello\n世界")
    expect(ranges.length).toBe(1)
    expect(ranges[0]!.start).toBe(6)
    expect(ranges[0]!.end).toBe(8)
    expect(ranges[0]!.byteStart).toBe(6)
    expect(ranges[0]!.byteEnd).toBe(12)
  })

  test("delete last line", () => expectRange("line1\nline2", "line1\n", 6, 6, 6, 6))

  test("CRLF byte offsets", () => expectRange("a\r\nb\r\nc\r\n", "a\r\nb\r\nX\r\nc\r\n", 6, 9, 6, 9))

  test("mixed CRLF and LF", () =>
    expectRange("line1\r\nline2\nline3", "line1\r\nline2\nnewLine\nline3", 13, 21, 13, 21))

  test("completely deleted content", () => expectRange("line1\nline2\nline3", "", 0, 0, 0, 0))

  test("delete single char", () => expectRange("a", "", 0, 0, 0, 0))

  test("empty content edge case", () => {
    const ranges = calculateRanges("", "")
    expect(ranges).toEqual([])
  })

  test("unicode surrogate pairs", () => {
    // 😀 occupies 2 JS code units; start/end must be code-unit offsets so tools
    // like prettier receive the right --range-start / --range-end values.
    const ranges = calculateRanges("", "😀a\n")
    expect(ranges.length).toBe(1)
    expect(ranges[0]!.start).toBe(0)
    expect(ranges[0]!.end).toBe(4) // 2 (😀) + 1 (a) + 1 (\n) code units
    expect(ranges[0]!.byteStart).toBe(0)
    expect(ranges[0]!.byteEnd).toBe(6) // 4 (😀 UTF-8) + 1 (a) + 1 (\n) bytes
    expect(Number.isNaN(ranges[0]!.byteEnd)).toBe(false)
  })
})

describe("DiffRange", () => {
  test("adjacent detection", () => {
    const a = DiffRange.create(0, 5, 0, 5)
    const b = DiffRange.create(6, 4, 6, 4)
    expect(DiffRange.adjacent(a, b)).toBe(true)
    const c = DiffRange.create(15, 5, 15, 5)
    expect(DiffRange.adjacent(a, c)).toBe(false)
  })

  test("merge", () => {
    const a = DiffRange.create(0, 5, 0, 5)
    const b = DiffRange.create(6, 4, 6, 4)
    const m = DiffRange.merge(a, b)
    expect(m.start).toBe(0)
    expect(m.end).toBe(10)
    expect(m.byteStart).toBe(0)
    expect(m.byteEnd).toBe(10)
  })

  test("toJSON", () => {
    const r = DiffRange.create(10, 5, 20, 10)
    const json = DiffRange.toJSON(r)
    expect(json).toEqual({ start: 10, end: 15, byteOffset: 20, byteLength: 10 })
  })

  test("toJSON omits undefined byteLength", () => {
    const r: DiffRange = { start: 10, end: 15 }
    const json = DiffRange.toJSON(r)
    expect(json.byteLength).toBeUndefined()
  })
})
