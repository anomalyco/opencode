import { describe, expect, mock, test } from "bun:test"
import { dict } from "@opencode/ui/i18n/en"

const t = (key: keyof typeof dict, params: Record<string, string>) =>
  dict[key].replace(/{{(\w+)}}/g, (_, name: string) => params[name])

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t, activitySummary: () => "work" }),
}))

const { formatElapsed, reuseActivityItems } = await import("@/session/composer/activity-chips")

describe("formatElapsed", () => {
  test.each([
    [0, "0s"],
    [12_400, "12s"],
    [59_999, "59s"],
    [60_000, "1m 00s"],
    [65_000, "1m 05s"],
    [3_599_000, "59m 59s"],
    [3_720_000, "1h 02m"],
    [-5_000, "0s"],
  ])("%p ms reads %p", (ms, expected) => expect(formatElapsed(ms, t)).toBe(expected))
})

describe("reuseActivityItems", () => {
  const subagent = (key: string, label: string, jobs?: readonly string[]) => {
    const base = {
      type: "subagent" as const,
      key,
      target: key,
      sessionID: key,
      agent: "general",
      label,
      started: 1_000,
    }

    if (!jobs) return base

    return { ...base, jobs }
  }

  test("returns the same array and item references when every row matches", () => {
    const first = [subagent("ses_1", "Alpha", ["job_1"]), subagent("ses_2", "Beta")]
    const next = [subagent("ses_1", "Alpha", ["job_1"]), subagent("ses_2", "Beta")]

    const merged = reuseActivityItems(first, next)
    expect(merged).toBe(first)
    expect(merged[0]).toBe(first[0])
    expect(merged[1]).toBe(first[1])
  })

  test("reuses unchanged rows while replacing only modified ones", () => {
    const first = [subagent("ses_1", "Alpha"), subagent("ses_2", "Beta")]
    const next = [subagent("ses_1", "Alpha"), subagent("ses_2", "Beta updated")]

    const merged = reuseActivityItems(first, next)
    expect(merged).not.toBe(first)
    expect(merged[0]).toBe(first[0])
    expect(merged[1]).toBe(next[1])
  })
})
