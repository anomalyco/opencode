import { describe, expect, test } from "bun:test"
import { promptPlaceholder } from "./placeholder"

describe("promptPlaceholder", () => {
  const t = (key: string, params?: Record<string, string>) => `${key}${params?.example ? `:${params.example}` : ""}`

  test("returns shell placeholder in shell mode", () => {
    const value = promptPlaceholder({
      mode: "shell",
      commentCount: 0,
      example: "example",
      t,
    })
    expect(value).toBe("prompt.placeholder.shell")
  })

  test("returns summarize placeholders for comment context", () => {
    expect(promptPlaceholder({ mode: "normal", commentCount: 1, example: "example", t })).toBe(
      "prompt.placeholder.summarizeComment",
    )
    expect(promptPlaceholder({ mode: "normal", commentCount: 2, example: "example", t })).toBe(
      "prompt.placeholder.summarizeComments",
    )
  })

  test("returns default placeholder with example", () => {
    const value = promptPlaceholder({
      mode: "normal",
      commentCount: 0,
      example: "translated-example",
      t,
    })
    expect(value).toBe("prompt.placeholder.normal:translated-example")
  })
})
