import { describe, expect, test } from "bun:test"
import { sliceLines } from "../../../src/workspace/helpers/lines"

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s)

describe("helpers/lines — sliceLines", () => {
  test("offset=1 returns from first line; limit bounds output", () => {
    const view = sliceLines(bytes("a\nb\nc\nd\n"), { offset: 1, limit: 2 })
    expect(view.raw).toEqual(["a", "b"])
    expect(view.offset).toBe(1)
    expect(view.more).toBe(true)
    expect(view.cut).toBe(false)
  })

  test("offset=3 skips the first two lines", () => {
    const view = sliceLines(bytes("a\nb\nc\nd"), { offset: 3, limit: 2 })
    expect(view.raw).toEqual(["c", "d"])
    expect(view.more).toBe(false)
  })

  test("returning fewer than limit sets more=false", () => {
    const view = sliceLines(bytes("x\n"), { offset: 1, limit: 10 })
    expect(view.raw).toEqual(["x"])
    expect(view.more).toBe(false)
    expect(view.cut).toBe(false)
    expect(view.count).toBe(1)
  })

  test("very long line is truncated with suffix", () => {
    const long = "a".repeat(3000)
    const view = sliceLines(bytes(long + "\nb"), { offset: 1, limit: 10 })
    expect(view.raw[0].startsWith("a".repeat(2000))).toBe(true)
    expect(view.raw[0].endsWith("line truncated to 2000 chars)")).toBe(true)
    expect(view.raw[1]).toBe("b")
  })

  test("CRLF line endings are treated as a single break", () => {
    const view = sliceLines(bytes("one\r\ntwo\r\nthree"), { offset: 1, limit: 10 })
    expect(view.raw).toEqual(["one", "two", "three"])
  })

  test("empty input returns empty view", () => {
    const view = sliceLines(bytes(""), { offset: 1, limit: 5 })
    expect(view.raw).toEqual([])
    expect(view.count).toBe(0)
    expect(view.more).toBe(false)
  })

  test("byte budget exceeded sets cut=true and more=true", () => {
    // Each line is ~1 KB; 100 lines easily overflows 50 KB.
    const line = "x".repeat(1000)
    const lines = Array.from({ length: 200 }, () => line).join("\n")
    const view = sliceLines(bytes(lines), { offset: 1, limit: 500 })
    expect(view.cut).toBe(true)
    expect(view.more).toBe(true)
  })
})
