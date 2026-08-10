import { describe, expect, test } from "bun:test"
import { LARGE_PASTE_BREAKS, LARGE_PASTE_CHARS, largePaste, normalizePaste, pasteMode } from "./paste"

function line(length: number) {
  return "a".repeat(length)
}

function lines(count: number, newline = "\n") {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join(newline)
}

describe("largePaste", () => {
  test("classifies by character count around the threshold", () => {
    expect(largePaste(line(1_000))).toBe(false)
    expect(largePaste(line(4_999))).toBe(false)
    expect(largePaste(line(5_000))).toBe(false)
    expect(largePaste(line(LARGE_PASTE_CHARS - 1))).toBe(false)
    expect(largePaste(line(LARGE_PASTE_CHARS))).toBe(true)
    expect(largePaste(line(LARGE_PASTE_CHARS + 1))).toBe(true)
  })

  test("classifies by line breaks around the threshold", () => {
    expect(largePaste(lines(LARGE_PASTE_BREAKS - 1))).toBe(false)
    expect(largePaste(lines(LARGE_PASTE_BREAKS))).toBe(false)
    expect(largePaste(lines(LARGE_PASTE_BREAKS + 1))).toBe(true)
    expect(largePaste(lines(LARGE_PASTE_BREAKS + 2))).toBe(true)
    expect(largePaste(lines(200))).toBe(true)
    expect(largePaste(lines(201))).toBe(true)
    expect(largePaste(lines(5_000))).toBe(true)
  })

  test("counts CRLF breaks the same as LF breaks", () => {
    expect(largePaste(lines(LARGE_PASTE_BREAKS, "\r\n"))).toBe(false)
    expect(largePaste(lines(LARGE_PASTE_BREAKS + 1, "\r\n"))).toBe(true)
  })

  test("decides multi-megabyte input without walking past the character threshold", () => {
    const huge = line(4 * 1024 * 1024)
    const started = performance.now()
    expect(largePaste(huge)).toBe(true)
    // A line-array allocation over 4 MiB takes tens of milliseconds; a length check is
    // constant time. The bound is loose on purpose so it cannot flake on slow machines.
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe("pasteMode", () => {
  test("keeps short single-line text on the native path", () => {
    expect(pasteMode("hello world")).toBe("native")
    expect(pasteMode(line(1_000))).toBe("native")
    expect(pasteMode(line(4_999))).toBe("native")
    expect(pasteMode(line(LARGE_PASTE_CHARS - 1))).toBe("native")
    expect(pasteMode("@mention and /command stay native")).toBe("native")
  })

  test("takes the model path for anything large or multi-line", () => {
    expect(pasteMode(line(LARGE_PASTE_CHARS))).toBe("manual")
    expect(pasteMode(line(LARGE_PASTE_CHARS + 1))).toBe("manual")
    expect(pasteMode(line(50_000))).toBe("manual")
    expect(pasteMode(line(100_000))).toBe("manual")
    expect(pasteMode(line(250_000))).toBe("manual")
    expect(pasteMode(line(500_000))).toBe("manual")
    expect(pasteMode(line(1_000_000))).toBe("manual")
    expect(pasteMode("a\nb")).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
    expect(pasteMode("a\rb")).toBe("manual")
  })
})

describe("normalizePaste", () => {
  test("returns the same string when there is nothing to normalize", () => {
    const text = "no carriage returns here"
    expect(normalizePaste(text)).toBe(text)
  })

  test("converts CRLF and lone CR to LF", () => {
    expect(normalizePaste("a\r\nb\rc\nd")).toBe("a\nb\nc\nd")
  })

  test("preserves every other character, including unicode and zero width", () => {
    const text = "héllo 🌍\tタブ\u200Bzero\r\nsecond"
    expect(normalizePaste(text)).toBe("héllo 🌍\tタブ\u200Bzero\nsecond")
  })

  test("normalizes a megabyte of CRLF losslessly", () => {
    const source = Array.from({ length: 20_000 }, (_, index) => `${index} ${line(40)}`).join("\r\n")
    const normalized = normalizePaste(source)
    expect(normalized).not.toContain("\r")
    expect(normalized.split("\n").length).toBe(20_000)
    expect(normalized.length).toBe(source.length - 19_999)
  })
})
