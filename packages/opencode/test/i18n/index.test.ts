import { describe, expect, test } from "bun:test"
import { datetime, normalizeLocale, plural, resolveLocale, t } from "../../src/i18n"

describe("i18n", () => {
  test("normalizes supported locales", () => {
    expect(normalizeLocale("en")).toBe("en")
    expect(normalizeLocale("zh-CN")).toBe("zh")
    expect(normalizeLocale("zh_TW")).toBe("zh")
    expect(normalizeLocale("unknown")).toBe("en")
  })

  test("resolves locale from config value before env", () => {
    expect(resolveLocale("zh", { LANG: "en_US.UTF-8" })).toBe("zh")
  })

  test("resolves locale from env fallback", () => {
    expect(resolveLocale(undefined, { LANG: "zh_CN.UTF-8" })).toBe("zh")
    expect(resolveLocale(undefined, { LC_ALL: "en_US.UTF-8" })).toBe("en")
    expect(resolveLocale(undefined, {})).toBe("en")
  })

  test("falls back to english strings", () => {
    expect(t("zh", "cli.export.intro")).toBe("导出会话")
    expect(t("en", "cli.export.intro")).toBe("Export session")
  })

  test("interpolates params", () => {
    expect(t("zh", "cli.export.not_found", { session: "ses_123" })).toContain("ses_123")
  })

  test("picks plural keys", () => {
    expect(plural("en", 1, { one: "tui.status.count.plugin.one", other: "tui.status.count.plugin.other" })).toBe(
      "tui.status.count.plugin.one",
    )
    expect(plural("en", 2, { one: "tui.status.count.plugin.one", other: "tui.status.count.plugin.other" })).toBe(
      "tui.status.count.plugin.other",
    )
  })

  test("formats datetime with explicit locale", () => {
    const value = datetime("en", Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(value.length).toBeGreaterThan(0)
  })
})
