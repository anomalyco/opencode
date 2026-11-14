import { describe, expect, test } from "bun:test"
import { TextBoundary } from "./text-boundary.js"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
const glyphs = ["é", "€", "😀", "\uFFFD"]
const samples = ["", "plain ascii", ...glyphs.map((glyph) => `ab${glyph}cd`), "😀é€\uFFFD😀"]

// Splits `text` into pieces of about `size`, ending each at a head boundary and falling back to tail for progress.
function pieces<T extends string | Uint8Array>(
  value: T,
  size: number,
  head: (value: T, index: number) => number,
  tail: (value: T, index: number) => number,
) {
  const result: T[] = []
  for (let start = 0; start < value.length; ) {
    const end = head(value, start + size)
    const stop = end > start ? end : tail(value, start + size)
    result.push(value.slice(start, stop) as T)
    start = stop
  }
  return result
}

describe("TextBoundary code units", () => {
  test.each(samples)("every cut of %j stays well formed and within the limit", (text) => {
    for (let index = 0; index <= text.length; index++) {
      const head = TextBoundary.head(text, index)
      const tail = TextBoundary.tail(text, index)
      expect(head).toBeLessThanOrEqual(index)
      expect(index - head).toBeLessThanOrEqual(1)
      expect(tail).toBeGreaterThanOrEqual(index)
      expect(tail - index).toBeLessThanOrEqual(1)
      expect(text.slice(0, head).isWellFormed()).toBe(true)
      expect(text.slice(head).isWellFormed()).toBe(true)
      expect(text.slice(0, tail).isWellFormed()).toBe(true)
      expect(text.slice(tail).isWellFormed()).toBe(true)
    }
  })

  test("only moves a cut through a surrogate pair", () => {
    // é, € and U+FFFD are one code unit each, so every cut is already safe.
    for (const glyph of ["é", "€", "\uFFFD"]) {
      const text = `ab${glyph}cd`
      for (let index = 0; index <= text.length; index++) {
        expect(TextBoundary.head(text, index)).toBe(index)
        expect(TextBoundary.tail(text, index)).toBe(index)
      }
    }
    expect(TextBoundary.head("ab😀cd", 3)).toBe(2)
    expect(TextBoundary.tail("ab😀cd", 3)).toBe(4)
  })

  test("keeps a genuine replacement character", () => {
    const text = "ok\uFFFD"
    expect(text.slice(0, TextBoundary.head(text, 3))).toBe("ok\uFFFD")
    expect(text.slice(TextBoundary.tail(text, 2))).toBe("\uFFFD")
  })

  test("clamps offsets to the text", () => {
    expect(TextBoundary.head("", 5)).toBe(0)
    expect(TextBoundary.tail("", -5)).toBe(0)
    expect(TextBoundary.head("abc", 10)).toBe(3)
    expect(TextBoundary.head("abc", -1)).toBe(0)
    expect(TextBoundary.tail("abc", 10)).toBe(3)
    expect(TextBoundary.tail("😀abc", 5 - 10)).toBe(0)
  })

  test("a budget smaller than the character gives an empty head", () => {
    expect(TextBoundary.head("😀", 1)).toBe(0)
    expect(TextBoundary.tail("😀", 1)).toBe(2)
  })

  test("drops lone halves at the cut edge of malformed input", () => {
    expect(TextBoundary.head("a\ud83d", 2)).toBe(1)
    expect(TextBoundary.tail("\ude00a", 0)).toBe(1)
  })

  test.each([1, 2, 3, 5])("splits into well-formed pieces of %i that join exactly", (size) => {
    for (const text of samples) {
      const parts = pieces(text, size, TextBoundary.head, TextBoundary.tail)
      expect(parts.join("")).toBe(text)
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0)
        expect(part.isWellFormed()).toBe(true)
        // Only a whole character bigger than the budget may run over it.
        if (part.length > size) expect([...part]).toHaveLength(1)
      }
    }
  })
})

describe("TextBoundary UTF-8 bytes", () => {
  test.each(samples)("every byte cut of %j decodes without replacement characters it did not have", (text) => {
    const bytes = encoder.encode(text)
    for (let index = 0; index <= bytes.length; index++) {
      const head = TextBoundary.utf8Head(bytes, index)
      const tail = TextBoundary.utf8Tail(bytes, index)
      expect(head).toBeLessThanOrEqual(index)
      expect(index - head).toBeLessThanOrEqual(3)
      expect(tail).toBeGreaterThanOrEqual(index)
      expect(tail - index).toBeLessThanOrEqual(3)
      // A fatal decoder throws on any incomplete sequence, so each side is valid on its own and they join exactly.
      expect(decoder.decode(bytes.subarray(0, head)) + decoder.decode(bytes.subarray(head))).toBe(text)
      expect(decoder.decode(bytes.subarray(0, tail)) + decoder.decode(bytes.subarray(tail))).toBe(text)
    }
  })

  test.each(glyphs)("moves a cut inside %s to the nearest whole character", (glyph) => {
    const bytes = encoder.encode(`ab${glyph}cd`)
    const width = encoder.encode(glyph).length
    for (let index = 3; index < 2 + width; index++) {
      expect(TextBoundary.utf8Head(bytes, index)).toBe(2)
      expect(TextBoundary.utf8Tail(bytes, index)).toBe(2 + width)
    }
    expect(TextBoundary.utf8Head(bytes, 2 + width)).toBe(2 + width)
    expect(TextBoundary.utf8Tail(bytes, 2)).toBe(2)
  })

  test("trims a capture that was already cut inside a character", () => {
    const capture = encoder.encode("x😀").subarray(0, 3)
    expect(decoder.decode(capture.subarray(0, TextBoundary.utf8Head(capture, capture.length)))).toBe("x")
  })

  test("keeps a genuine replacement character", () => {
    const bytes = encoder.encode("ok\uFFFD")
    expect(TextBoundary.utf8Head(bytes, bytes.length)).toBe(bytes.length)
    expect(TextBoundary.utf8Tail(bytes, 2)).toBe(2)
  })

  test("clamps offsets and handles empty input", () => {
    const empty = new Uint8Array()
    expect(TextBoundary.utf8Head(empty, 4)).toBe(0)
    expect(TextBoundary.utf8Tail(empty, -4)).toBe(0)
    expect(TextBoundary.utf8Head(encoder.encode("abc"), 10)).toBe(3)
    expect(TextBoundary.utf8Tail(encoder.encode("abc"), -1)).toBe(0)
  })

  test("leaves bytes that are not UTF-8 where they are", () => {
    const continuation = Uint8Array.of(0x41, 0x80, 0x80, 0x80, 0x80, 0x41)
    expect(TextBoundary.utf8Head(continuation, 5)).toBe(5)
    expect(TextBoundary.utf8Tail(continuation, 1)).toBe(1)
    expect(TextBoundary.utf8Head(Uint8Array.of(0x41, 0xff), 2)).toBe(2)
  })

  test.each([1, 2, 3, 5])("splits into pieces of %i bytes that decode on their own and join exactly", (size) => {
    for (const text of samples) {
      const parts = pieces(encoder.encode(text), size, TextBoundary.utf8Head, TextBoundary.utf8Tail)
      expect(parts.map((part) => decoder.decode(part)).join("")).toBe(text)
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0)
        if (part.length > size) expect([...decoder.decode(part)]).toHaveLength(1)
      }
    }
  })
})
