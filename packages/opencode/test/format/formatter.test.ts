import { describe, expect, test } from "bun:test"
import * as Formatter from "../../src/format/formatter"
import type { DiffRange } from "../../src/format/diff-range"

describe("prettier.buildRangeCommand", () => {
  const bin = "/usr/local/bin/prettier"
  const cmd = [bin, "--write", "$FILE"]

  test("single range returns one command", () => {
    const ranges: DiffRange[] = [{ start: 10, end: 20 }]
    expect(Formatter.prettier.buildRangeCommand!("file.ts", cmd, ranges)).toEqual([
      [bin, "--write", "--range-start=10", "--range-end=20", "file.ts"],
    ])
  })

  test("multiple ranges run backwards — highest start offset first", () => {
    const ranges: DiffRange[] = [
      { start: 5, end: 15 },
      { start: 30, end: 50 },
    ]
    expect(Formatter.prettier.buildRangeCommand!("file.ts", cmd, ranges)).toEqual([
      [bin, "--write", "--range-start=30", "--range-end=50", "file.ts"],
      [bin, "--write", "--range-start=5", "--range-end=15", "file.ts"],
    ])
  })

  test("three ranges are sorted strictly backwards", () => {
    const ranges: DiffRange[] = [
      { start: 100, end: 110 },
      { start: 5, end: 15 },
      { start: 50, end: 60 },
    ]
    const result = Formatter.prettier.buildRangeCommand!("file.ts", cmd, ranges)
    const starts = result.map((c) => Number(c[2]!.replace("--range-start=", "")))
    expect(starts).toEqual([100, 50, 5])
  })

  test("uses binary from cmd[0]", () => {
    const customBin = "/home/user/.npm/prettier"
    const ranges: DiffRange[] = [{ start: 0, end: 5 }]
    const result = Formatter.prettier.buildRangeCommand!("file.ts", [customBin, "--write", "$FILE"], ranges)
    expect(result[0]![0]).toBe(customBin)
  })

  test("zero-length range (deletion marker)", () => {
    const ranges: DiffRange[] = [{ start: 42, end: 42 }]
    expect(Formatter.prettier.buildRangeCommand!("file.ts", cmd, ranges)).toEqual([
      [bin, "--write", "--range-start=42", "--range-end=42", "file.ts"],
    ])
  })

  test("does not mutate input ranges array", () => {
    const ranges: DiffRange[] = [
      { start: 5, end: 15 },
      { start: 30, end: 50 },
    ]
    const copy = [...ranges]
    Formatter.prettier.buildRangeCommand!("file.ts", cmd, ranges)
    expect(ranges).toEqual(copy)
  })
})

describe("clang.buildRangeCommand", () => {
  const bin = "/usr/bin/clang-format"
  const cmd = [bin, "-i", "$FILE"]

  test("single range with byte offsets", () => {
    const ranges: DiffRange[] = [{ start: 0, end: 10, byteStart: 0, byteEnd: 15 }]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([
      [bin, "-i", "--offset=0", "--length=15", "file.cpp"],
    ])
  })

  test("multiple ranges each get their own offset/length pair in one command", () => {
    const ranges: DiffRange[] = [
      { start: 0, end: 10, byteStart: 0, byteEnd: 15 },
      { start: 20, end: 30, byteStart: 20, byteEnd: 38 },
    ]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([
      [bin, "-i", "--offset=0", "--length=15", "--offset=20", "--length=18", "file.cpp"],
    ])
  })

  test("falls back to full-file when byte offsets are missing", () => {
    const ranges: DiffRange[] = [{ start: 0, end: 10 }]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([[bin, "-i", "file.cpp"]])
  })

  test("falls back to full-file when only some ranges have byte offsets", () => {
    const ranges: DiffRange[] = [
      { start: 0, end: 10, byteStart: 0, byteEnd: 10 },
      { start: 20, end: 30 },
    ]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([[bin, "-i", "file.cpp"]])
  })

  test("non-zero byteStart produces correct offset and length", () => {
    const ranges: DiffRange[] = [{ start: 5, end: 10, byteStart: 8, byteEnd: 20 }]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([
      [bin, "-i", "--offset=8", "--length=12", "file.cpp"],
    ])
  })

  test("zero-length range (deletion marker) produces zero length", () => {
    const ranges: DiffRange[] = [{ start: 10, end: 10, byteStart: 10, byteEnd: 10 }]
    expect(Formatter.clang.buildRangeCommand!("file.cpp", cmd, ranges)).toEqual([
      [bin, "-i", "--offset=10", "--length=0", "file.cpp"],
    ])
  })
})
