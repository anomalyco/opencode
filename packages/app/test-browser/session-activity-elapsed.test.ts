import { describe, expect, mock, test } from "bun:test"
import { dict } from "@opencode/ui/i18n/en"

const t = (key: keyof typeof dict, params: Record<string, string>) =>
  dict[key].replace(/{{(\w+)}}/g, (_, name: string) => params[name])

mock.module("@/runtime/i18n/language", () => ({
  useLanguage: () => ({ t, activitySummary: () => "work" }),
}))

const { formatElapsed } = await import("@/session/composer/activity-chips")

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
