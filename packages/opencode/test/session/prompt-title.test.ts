import { describe, expect, test } from "bun:test"
import { cleanGeneratedTitle } from "../../src/session/prompt"

describe("session.prompt title", () => {
  test("unwraps Claude Code structured title responses", () => {
    expect(cleanGeneratedTitle('{"title":"Subscription usage implementation"}')).toBe(
      "Subscription usage implementation",
    )
  })

  test("preserves plain-text title responses", () => {
    expect(cleanGeneratedTitle("<think>hidden</think>\nPlain title\nIgnored line")).toBe("Plain title")
  })
})
