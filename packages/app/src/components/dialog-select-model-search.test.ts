import { describe, expect, test } from "bun:test"
import { matchesModelSearch } from "./dialog-select-model-search"

describe("matchesModelSearch", () => {
  test("matches model names across separators", () => {
    expect(matchesModelSearch("gpt 5", ["GPT-5.5"])).toBe(true)
    expect(matchesModelSearch("gpt-5", ["GPT-5.5"])).toBe(true)
    expect(matchesModelSearch("gpt5", ["GPT-5.5"])).toBe(true)
  })

  test("matches any searchable model field", () => {
    expect(matchesModelSearch("open ai", ["GPT-5.5", "gpt-5.5", "OpenAI"])).toBe(true)
    expect(matchesModelSearch("gpt 5", ["GPT-5.5", "gpt-5.5", "OpenAI"])).toBe(true)
  })

  test("does not match unrelated searches", () => {
    expect(matchesModelSearch("claude", ["GPT-5.5", "gpt-5.5", "OpenAI"])).toBe(false)
  })

  test("matches model names via word-initial abbreviation", () => {
    // "deepseek v4 flash free" → initials "dvff", compact "deepseekv4flashfree"
    // "deepseek v4 pro" → initials "dvp", compact "deepseekv4pro"
    expect(matchesModelSearch("deepff", ["Deepseek V4 Flash Free"])).toBe(true)
    expect(matchesModelSearch("deepp", ["Deepseek V4 Pro"])).toBe(true)
    expect(matchesModelSearch("dvff", ["Deepseek V4 Flash Free"])).toBe(true)
    expect(matchesModelSearch("deepv4", ["Deepseek V4 Flash Free"])).toBe(true)
    // Should NOT match unrelated abbreviations
    expect(matchesModelSearch("deepff", ["Deepseek V4 Pro"])).toBe(false)
    expect(matchesModelSearch("deepp", ["Deepseek V4 Flash Free"])).toBe(false)
  })

  test("abbreviation matching distinguishes similar models", () => {
    const models = ["Deepseek V4 Flash Free", "Deepseek V4 Flash", "Deepseek V4 Pro"]
    expect(matchesModelSearch("deepff", models)).toBe(true) // matches Flash Free only via abbreviation
    expect(matchesModelSearch("deepf", models)).toBe(true)  // matches both Flash Free and Flash
    expect(matchesModelSearch("deepp", models)).toBe(true)  // matches Pro only
  })
})
