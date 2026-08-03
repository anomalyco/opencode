import { describe, expect, test } from "bun:test"
import { resolveLocale, translate } from "../src/i18n"

describe("TUI locale", () => {
  test("uses an explicit supported locale", () => {
    expect(resolveLocale("zh-CN", { LANG: "en_US.UTF-8" })).toBe("zh-CN")
  })

  test("detects Chinese system locales", () => {
    expect(resolveLocale(undefined, { LANG: "zh_CN.UTF-8" })).toBe("zh-CN")
    expect(resolveLocale(undefined, { LC_MESSAGES: "zh", LANG: "en_US.UTF-8" })).toBe("zh-CN")
    expect(resolveLocale(undefined, { LC_ALL: "en_US.UTF-8", LC_MESSAGES: "zh_CN.UTF-8" })).toBe("en")
  })

  test("falls back to English for unsupported values", () => {
    expect(resolveLocale("fr", { LANG: "en_US.UTF-8" })).toBe("en")
    expect(translate("zh-CN", "palette.commands")).toBe("命令")
  })
})