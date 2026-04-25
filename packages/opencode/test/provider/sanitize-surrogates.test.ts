import { describe, expect, test } from "bun:test"
import { fixJsonSurrogateEscapes, sanitizeSurrogates } from "../../src/provider/sanitize-surrogates"

describe("sanitizeSurrogates", () => {
  test("keeps well-formed content unchanged", () => {
    const input = '{"message":"hello","emoji":"😀"}'
    expect(sanitizeSurrogates(input)).toBe(input)
  })

  test("replaces lone surrogate code units", () => {
    const input = `before${"\ud800"}after`
    expect(sanitizeSurrogates(input)).toBe("before\uFFFDafter")
  })

  test("replaces JSON-escaped lone high surrogate", () => {
    const input = '{"text":"\\ud800"}'
    expect(sanitizeSurrogates(input)).toBe('{"text":"\\uFFFD"}')
  })

  test("replaces JSON-escaped lone low surrogate", () => {
    const input = '{"text":"\\udc00"}'
    expect(sanitizeSurrogates(input)).toBe('{"text":"\\uFFFD"}')
  })

  test("keeps valid JSON surrogate pairs", () => {
    const input = '{"text":"\\ud83d\\ude00"}'
    expect(sanitizeSurrogates(input)).toBe(input)
  })
})

describe("fixJsonSurrogateEscapes", () => {
  test("fixes mixed escaped surrogates while preserving valid pairs", () => {
    const input = '{"a":"\\ud800","b":"\\ud83d\\ude00","c":"\\udc00"}'
    expect(fixJsonSurrogateEscapes(input)).toBe('{"a":"\\uFFFD","b":"\\ud83d\\ude00","c":"\\uFFFD"}')
  })
})
