import { describe, expect, test } from "bun:test"
import { redactEaLabJson, redactEaLabText } from "../../../../.opencode/ea-lab-core/redaction"

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

  test("redacts lowercase secret query parameters in arbitrary text", () => {
    const result = redactEaLabText(
      "https://example.test/report?token=raw-token-1234567890&api_key=raw-api-key-1234567890&symbol=XAUUSD#refresh_token=raw-refresh-1234567890",
    )
    expect(result.text).not.toContain("raw-token-1234567890")
    expect(result.text).not.toContain("raw-api-key-1234567890")
    expect(result.text).not.toContain("raw-refresh-1234567890")
    expect(result.text).toContain("token=[REDACTED_SECRET]")
    expect(result.text).toContain("api_key=[REDACTED_SECRET]")
    expect(result.text).toContain("refresh_token=[REDACTED_SECRET]")
    expect(result.text).toContain("symbol=XAUUSD")
  })

  test("redacts JSON values for sensitive keys", () => {
    const result = redactEaLabJson(
      JSON.stringify({ token: "raw-token-1234567890", nested: { api_key: "raw-api-key-1234567890" }, ok: "XAUUSD" }),
      "payload_json",
    )
    expect(result).toContain('"token":"[REDACTED_SECRET]"')
    expect(result).toContain('"api_key":"[REDACTED_SECRET]"')
    expect(result).toContain('"ok":"XAUUSD"')
  })
})
