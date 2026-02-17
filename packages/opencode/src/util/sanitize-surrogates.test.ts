import { describe, test, expect } from "bun:test"
import { sanitizeSurrogates } from "./sanitize-surrogates"

describe("sanitizeSurrogates", () => {
  test("replaces lone high surrogate", () => {
    expect(sanitizeSurrogates("\uD800")).toBe("\uFFFD")
  })

  test("replaces lone low surrogate", () => {
    expect(sanitizeSurrogates("\uDC00")).toBe("\uFFFD")
  })

  test("preserves valid surrogate pair", () => {
    const emoji = "\uD83D\uDE00"
    expect(sanitizeSurrogates(emoji)).toBe(emoji)
  })

  test("preserves normal text", () => {
    expect(sanitizeSurrogates("hello world")).toBe("hello world")
  })

  test("preserves Korean text", () => {
    expect(sanitizeSurrogates("안녕하세요")).toBe("안녕하세요")
  })

  test("preserves empty string", () => {
    expect(sanitizeSurrogates("")).toBe("")
  })

  test("replaces surrogate in middle", () => {
    expect(sanitizeSurrogates("hello\uD800world")).toBe("hello\uFFFDworld")
  })

  test("result is well-formed", () => {
    const result = sanitizeSurrogates("test\uD800\uDBFF\uDC00data\uDFFF")
    expect(result.isWellFormed()).toBe(true)
  })
})
