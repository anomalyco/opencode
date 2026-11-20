import { expect, test } from "bun:test"
import { resolveTemplate } from "@opencode/ui/context/i18n"
import { dict } from "@opencode/ui/i18n/en"
import { formatDuration } from "./duration"

const i18n = {
  locale: () => "en",
  t: (key: string, params?: Record<string, string | number | boolean>) => resolveTemplate(dict[key], params),
}

test("uses seconds, then minutes, then hours", () => {
  expect(formatDuration(42, i18n)).toBe("42s")
  expect(formatDuration(65, i18n)).toBe("1m 5s")
  expect(formatDuration(59 * 60 + 59, i18n)).toBe("59m 59s")
  expect(formatDuration(3600, i18n)).toBe("1h 0m")
  expect(formatDuration(2 * 3600 + 5 * 60 + 3, i18n)).toBe("2h 5m")
})

test("drops fractions and clamps clock skew to zero", () => {
  expect(formatDuration(12.9, i18n)).toBe("12s")
  expect(formatDuration(-4, i18n)).toBe("0s")
})
