import { describe, expect, test } from "bun:test"
import { formatTokenCount, formatTps } from "./tokens"

describe("formatTokenCount", () => {
  test("formats small numbers as-is", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(42)).toBe("42")
    expect(formatTokenCount(999)).toBe("999")
  })

  test("formats thousands with K suffix", () => {
    expect(formatTokenCount(1_000)).toBe("1.0K")
    expect(formatTokenCount(1_500)).toBe("1.5K")
    expect(formatTokenCount(10_000)).toBe("10K")
    expect(formatTokenCount(10_500)).toBe("11K")
    expect(formatTokenCount(99_999)).toBe("100K")
    expect(formatTokenCount(500_000)).toBe("500K")
  })

  test("rolls K to M at boundary", () => {
    expect(formatTokenCount(999_499)).toBe("999K")
    expect(formatTokenCount(999_500)).toBe("1.0M")
    expect(formatTokenCount(999_999)).toBe("1.0M")
  })

  test("formats millions with M suffix", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M")
    expect(formatTokenCount(1_500_000)).toBe("1.5M")
    expect(formatTokenCount(4_470_000)).toBe("4.5M")
    expect(formatTokenCount(10_000_000)).toBe("10M")
  })
})

describe("formatTps", () => {
  test("formats sub-1 as <1", () => {
    expect(formatTps(0)).toBe("<1")
    expect(formatTps(0.01)).toBe("<1")
    expect(formatTps(0.5)).toBe("<1")
    expect(formatTps(0.99)).toBe("<1")
  })

  test("formats single digits with one decimal", () => {
    expect(formatTps(1.0)).toBe("1.0")
    expect(formatTps(5.7)).toBe("5.7")
    expect(formatTps(9.9)).toBe("9.9")
    expect(formatTps(9.94)).toBe("9.9")
  })

  test("transitions cleanly at 10 boundary", () => {
    expect(formatTps(9.95)).toBe("10")
    expect(formatTps(9.99)).toBe("10")
    expect(formatTps(10)).toBe("10")
  })

  test("formats 10+ as integers", () => {
    expect(formatTps(10.5)).toBe("11")
    expect(formatTps(142.3)).toBe("142")
    expect(formatTps(1000)).toBe("1000")
  })
})
