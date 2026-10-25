import { describe, expect, test } from "bun:test"
import { again, attempts, invalid, partial, report } from "../../../src/cli/cmd/run/attempt"

describe("invalid", () => {
  test("accepts sensible settings", () => {
    expect(invalid({})).toBeUndefined()
    expect(invalid({ timeout: 30 })).toBeUndefined()
    expect(invalid({ timeout: 0.5, retries: 0 })).toBeUndefined()
    expect(invalid({ retries: 3 })).toBeUndefined()
  })

  test("rejects non-positive timeouts", () => {
    expect(invalid({ timeout: 0 })).toContain("--timeout")
    expect(invalid({ timeout: -5 })).toContain("--timeout")
    expect(invalid({ timeout: Number.NaN })).toContain("--timeout")
  })

  test("rejects negative or fractional retries", () => {
    expect(invalid({ retries: -1 })).toContain("--retries")
    expect(invalid({ retries: 1.5 })).toContain("--retries")
  })
})

describe("attempts and again", () => {
  test("budget is retries plus the initial attempt", () => {
    expect(attempts({})).toBe(1)
    expect(attempts({ retries: 2 })).toBe(3)
  })

  test("again allows exactly the budget", () => {
    expect(again(1, { retries: 2 })).toBe(true)
    expect(again(2, { retries: 2 })).toBe(true)
    expect(again(3, { retries: 2 })).toBe(false)
    expect(again(1, {})).toBe(false)
  })
})

describe("partial", () => {
  test("captures assistant text parts in order", () => {
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "prompt" }] },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool" }, { type: "text", text: "first chunk" }, { type: "text", text: "second chunk" }],
      },
    ]
    expect(partial(messages)).toBe("first chunk\n\nsecond chunk")
  })

  test("skips empty and whitespace-only parts", () => {
    const messages = [{ info: { role: "assistant" }, parts: [{ type: "text", text: "  " }, { type: "text" }] }]
    expect(partial(messages)).toBe("")
  })

  test("returns empty for no assistant output", () => {
    expect(partial([])).toBe("")
    expect(partial([{ info: { role: "user" }, parts: [{ type: "text", text: "hi" }] }])).toBe("")
  })
})

describe("report", () => {
  test("mentions the timeout and attempt position", () => {
    expect(report(1, { timeout: 30, retries: 1 })).toBe("run timed out after 30s (attempt 1/2)")
  })

  test("omits the position without retries", () => {
    expect(report(1, { timeout: 5 })).toBe("run timed out after 5s")
  })
})
