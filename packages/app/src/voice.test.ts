import { describe, expect, test } from "bun:test"
import { withVoiceTranscriptSpacing } from "./voice"

describe("voice transcript spacing", () => {
  test("inserts into an empty prompt without padding", () => {
    expect(withVoiceTranscriptSpacing("", 0, " hello ")).toBe("hello")
  })

  test("adds a leading space at the end of text", () => {
    expect(withVoiceTranscriptSpacing("hello", 5, "world")).toBe(" world")
  })

  test("adds surrounding spaces between words", () => {
    expect(withVoiceTranscriptSpacing("helloworld", 5, "there")).toBe(" there ")
  })

  test("does not duplicate existing whitespace", () => {
    expect(withVoiceTranscriptSpacing("hello  world", 6, "there")).toBe("there")
  })
})
