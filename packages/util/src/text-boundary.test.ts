import { describe, expect, test } from "bun:test"
import { TextBoundary } from "./text-boundary.js"

const encoder = new TextEncoder()
const samples = ["", "ascii", "ab😀cd", "😀é€\uFFFD😀"]

describe("TextBoundary", () => {
  test.each(samples)("every head and tail of %j keeps whole characters within the limit", (text) => {
    for (let limit = 0; limit <= text.length + 1; limit++) {
      const head = TextBoundary.head(text, limit)
      const tail = TextBoundary.tail(text, limit)
      expect(text.startsWith(head)).toBe(true)
      expect(text.endsWith(tail)).toBe(true)
      for (const part of [head, tail]) {
        expect(part.isWellFormed()).toBe(true)
        expect(part.length).toBeLessThanOrEqual(limit)
        expect(part.length).toBeGreaterThanOrEqual(Math.min(limit, text.length) - 1)
      }
    }
  })

  test.each(samples)("every UTF-8 tail of %j keeps whole characters within the limit", (text) => {
    const bytes = encoder.encode(text)
    for (let limit = 0; limit <= bytes.length + 1; limit++) {
      const tail = TextBoundary.utf8Tail(bytes, limit)
      expect(text.endsWith(tail)).toBe(true)
      expect(encoder.encode(tail).length).toBeLessThanOrEqual(limit)
      expect(encoder.encode(tail).length).toBeGreaterThanOrEqual(Math.min(limit, bytes.length) - 3)
    }
  })

  test("keeps malformed input that is not at the cut", () => {
    expect(TextBoundary.head("a\ud83d", 2)).toBe("a\ud83d")
    expect(TextBoundary.head("a\ud83db", 2)).toBe("a")
    expect(TextBoundary.tail("\ude00a", 2)).toBe("\ude00a")
    expect(TextBoundary.tail("b\ude00a", 2)).toBe("a")
    expect(TextBoundary.utf8Tail(Uint8Array.of(0x80, 0x41), 2)).toBe("\uFFFDA")
  })
})
