import { describe, it, expect } from "bun:test"
import { truncate, truncateLeft, truncateMiddle } from "./locale"

describe("truncate", () => {
  it("returns the string unchanged when its rendered width fits", () => {
    const input = "hello"
    expect(truncate(input, 10)).toBe(input)
    expect(truncate(input, 5)).toBe(input)
  })

  it("does not truncate a U+200B-prefixed string whose rendered width equals the limit", () => {
    const input = "\u200BSisyphus"
    expect(Bun.stringWidth(input)).toBe(8)
    expect(truncate(input, 8)).toBe(input)
  })

  it("truncates a U+200B-prefixed string whose rendered width exceeds the limit at the visible boundary", () => {
    const input = "\u200BSisyphus: Ultraworker"
    const result = truncate(input, 10)
    expect(result.endsWith("…")).toBe(true)
    const body = result.slice(0, -1)
    expect(Bun.stringWidth(body) + 1).toBeLessThanOrEqual(10)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(10)
    expect(result).toBe("\u200BSisyphus:…")
  })

  it("truncates plain ASCII to display width ending in ellipsis", () => {
    const result = truncate("Sisyphus: Ultraworker", 10)
    expect(result.endsWith("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBe(10)
    expect(result).toBe("Sisyphus:…")
  })

  it("handles all zero-width codepoint variants (U+200C, U+200D, U+FEFF)", () => {
    const zwnj = "\u200CSisyphus: Ultraworker"
    const zwj = "\u200DSisyphus: Ultraworker"
    const bom = "\uFEFFSisyphus: Ultraworker"
    const resultZwnj = truncate(zwnj, 10)
    const resultZwj = truncate(zwj, 10)
    const resultBom = truncate(bom, 10)
    expect(resultZwnj.endsWith("…")).toBe(true)
    expect(resultZwj.endsWith("…")).toBe(true)
    expect(resultBom.endsWith("…")).toBe(true)
    expect(Bun.stringWidth(resultZwnj)).toBeLessThanOrEqual(10)
    expect(Bun.stringWidth(resultZwj)).toBeLessThanOrEqual(10)
    expect(Bun.stringWidth(resultBom)).toBeLessThanOrEqual(10)
    expect(resultZwnj).toBe("\u200CSisyphus:…")
    expect(resultZwj).toBe("\u200DSisyphus:…")
    expect(resultBom).toBe("\uFEFFSisyphus:…")
  })

  it("truncates mixed strings containing a wide CJK grapheme, ZWSP, and ASCII correctly", () => {
    const input = "中\u200BSisyphus: Ultraworker"
    expect(Bun.stringWidth("中")).toBe(2)
    const result = truncate(input, 10)
    expect(result.endsWith("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(10)
    expect(result).toBe("中\u200BSisyphu…")
  })
})

describe("truncateLeft", () => {
  it("returns the string unchanged when its rendered width fits", () => {
    const input = "hello"
    expect(truncateLeft(input, 10)).toBe(input)
    expect(truncateLeft(input, 5)).toBe(input)
  })

  it("truncates a U+200B-prefixed string from the left at the correct visible boundary", () => {
    const input = "\u200BSisyphus: Ultraworker"
    const result = truncateLeft(input, 10)
    expect(result.startsWith("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(10)
  })
})

describe("truncateMiddle", () => {
  it("returns the string unchanged when its rendered width is <= maxLength", () => {
    const input = "hello world"
    expect(truncateMiddle(input, 20)).toBe(input)
    expect(truncateMiddle(input, 11)).toBe(input)
  })

  it("does not truncate a U+200B-prefixed string at exact width", () => {
    const input = "\u200BSisyphus"
    expect(Bun.stringWidth(input)).toBe(8)
    expect(truncateMiddle(input, 8)).toBe(input)
  })

  it("truncates a long ZWSP-bearing string in the middle with correct widths", () => {
    const input = "\u200BSisyphus: Ultraworker helps you"
    const maxLength = 15
    const result = truncateMiddle(input, maxLength)
    expect(result.includes("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(maxLength)
    expect(result.startsWith("\u200B")).toBe(true)
    expect(result.endsWith("u")).toBe(true)
  })

  it("uses a default maxLength of 35", () => {
    const short = "a".repeat(35)
    expect(truncateMiddle(short)).toBe(short)
    const long = "a".repeat(50)
    const result = truncateMiddle(long)
    expect(result.includes("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(35)
  })

  it("truncates plain ASCII with unchanged behavior", () => {
    const input = "abcdefghijklmnopqrstuvwxyz"
    const result = truncateMiddle(input, 10)
    expect(result.includes("…")).toBe(true)
    expect(Bun.stringWidth(result)).toBeLessThanOrEqual(10)
    expect(result).toBe("abcde…wxyz")
  })
})
