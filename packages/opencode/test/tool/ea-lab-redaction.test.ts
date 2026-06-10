import { describe, expect, test } from "bun:test"
import { redactEaLabText } from "../../../../.opencode/ea-lab-core/redaction"

describe("ea-lab redaction", () => {
  test("redacts common secret-like values", () => {
    const text = [
      "Authorization: Bearer abcdef1234567890",
      "OPENAI_API_KEY=sk-proj-testsecret",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz",
      "password: hunter2",
      "account login 12345678",
    ].join("\n")

    const result = redactEaLabText(text)
    expect(result.text).toContain("Authorization: Bearer [REDACTED_TOKEN]")
    expect(result.text).toContain("OPENAI_API_KEY=[REDACTED_SECRET]")
    expect(result.text).toContain("GITHUB_TOKEN=[REDACTED_SECRET]")
    expect(result.text).toContain("password: [REDACTED_SECRET]")
    expect(result.text).toContain("account login [REDACTED_ACCOUNT]")
    expect(result.redactions.length).toBeGreaterThanOrEqual(5)
  })

  test("leaves ordinary trading text intact", () => {
    const result = redactEaLabText("XAUUSD breakout pullback failed OOS with low trade count")
    expect(result.text).toBe("XAUUSD breakout pullback failed OOS with low trade count")
    expect(result.redactions).toEqual([])
  })
})
