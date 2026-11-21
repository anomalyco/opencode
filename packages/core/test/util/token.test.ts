import { describe, expect, test } from "bun:test"
import { Token } from "@opencode/core/util/token"

describe("Token.estimate", () => {
  test("counts other text at four characters per token", () => {
    expect(Token.estimate("")).toBe(0)
    expect(Token.estimate("a".repeat(400))).toBe(100)
    expect(Token.estimate("abcdef")).toBe(2)
    expect(Token.estimate("Привет, мир")).toBe(3)
  })

  test("counts Hangul syllables and jamo at 0.65 tokens each", () => {
    expect(Token.estimate("가".repeat(100))).toBe(65)
    expect(Token.estimate("ㅋ".repeat(10))).toBe(7)
    expect(Token.estimate("ᄀ".repeat(5))).toBe(3)
    // 12 syllables x 0.65 + 11 other characters / 4 = 10.55 (length / 4 gave 6).
    expect(Token.estimate("안녕하세요, 제 이름은 GPT-4o입니다.")).toBe(11)
  })

  test("counts CJK ideographs, kana and full-width punctuation at 0.6 tokens each", () => {
    expect(Token.estimate("你好世界，こんにちは。")).toBe(7)
  })

  test("weights mixed Hangul and CJK separately", () => {
    // 10 Hangul x 0.65 + 10 CJK x 0.6 = 12.5
    expect(Token.estimate("가".repeat(10) + "你".repeat(10))).toBe(13)
  })

  test("leaves astral ideographs at two UTF-16 units of four characters per token", () => {
    expect(Token.estimate("𠀀".repeat(10))).toBe(5)
  })
})
