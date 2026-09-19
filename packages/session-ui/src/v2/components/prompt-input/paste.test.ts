import { describe, expect, test } from "bun:test"
import { isLargePaste, LARGE_PASTE_CHARS, LARGE_PASTE_LINES, normalizePaste } from "./paste"

describe("prompt input V2 paste policy", () => {
  test("keeps short single-line text below the large-paste threshold", () => {
    expect(isLargePaste("1".repeat(LARGE_PASTE_CHARS - 1))).toBe(false)
    expect(isLargePaste("1".repeat(8 * 1024))).toBe(false)
  })

  test("classifies text at the character threshold as large", () => {
    expect(isLargePaste("1".repeat(LARGE_PASTE_CHARS))).toBe(true)
    expect(isLargePaste("1".repeat(LARGE_PASTE_CHARS + 1))).toBe(true)
  })

  test("classifies text at the line threshold as large", () => {
    expect(isLargePaste(Array.from({ length: LARGE_PASTE_LINES + 1 }, () => "1").join("\n"))).toBe(true)
  })

  test("classifies a 64 KB multiline fixture as large", () => {
    expect(isLargePaste(Array.from({ length: 512 }, () => "1".repeat(128)).join("\n"))).toBe(true)
  })

  test("normalizes Windows and classic Mac line endings before classification", () => {
    const text = normalizePaste("first\r\nsecond\rthird")

    expect(text).toBe("first\nsecond\nthird")
    expect(isLargePaste(text)).toBe(false)
  })

  test("classifies the 140--170 KB regression fixture without parsing editor DOM", () => {
    const text = Array.from({ length: 1400 }, () => "1".repeat(120)).join("\n")

    expect(text.length).toBeGreaterThanOrEqual(140 * 1024)
    expect(text.length).toBeLessThanOrEqual(170 * 1024)
    expect(isLargePaste(text)).toBe(true)
  })
})
