import { describe, expect, test } from "bun:test"
import { promptPlaceholder } from "./placeholder"

describe("promptPlaceholder", () => {
  const t = (key: string, params?: Record<string, string>) => {
    const parts = [key]
    if (params?.example) parts.push(params.example)
    if (params?.name) parts.push(params.name)
    if (params?.description) parts.push(params.description)
    return parts.join(":")
  }

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

  test("returns agent description placeholder when agent has description", () => {
    const value = promptPlaceholder({
      mode: "normal",
      commentCount: 0,
      example: "example",
      agent: { name: "build", description: "a coding agent" },
      t,
    })
    expect(value).toBe("prompt.placeholder.agent:build:a coding agent")
  })

  test("returns default placeholder when agent has no description", () => {
    const value = promptPlaceholder({
      mode: "normal",
      commentCount: 0,
      example: "translated-example",
      agent: { name: "build" },
      t,
    })
    expect(value).toBe("prompt.placeholder.normal:translated-example")
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
