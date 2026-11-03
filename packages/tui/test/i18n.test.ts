import { describe, expect, test } from "bun:test"
import en from "../src/i18n/en"
import { loaders } from "../src/i18n/loaders"
import { createLanguage, loadDictionary } from "../src/i18n/translate"
import type { Locale } from "../src/i18n/locales"

describe("TUI translations", () => {
  for (const [locale, load] of Object.entries(loaders)) {
    test(`${locale} covers the English catalog and preserves placeholders`, async () => {
      const { dict } = await load()
      expect(Object.keys(en).filter((key) => !Object.hasOwn(dict, key))).toEqual([])
      for (const [key, value] of Object.entries(en) as [keyof typeof en, string][]) {
        expect(dict[key]?.trim(), key).toBeTruthy()
        expect(placeholders(dict[key]), key).toEqual(placeholders(value))
      }
      for (const [key, value] of Object.entries(dict)) {
        if (!/\.(zero|two|few|many)$/.test(key)) continue
        const source = en[key.replace(/\.(zero|two|few|many)$/, ".other") as keyof typeof en]
        if (source === undefined) continue
        expect(value.trim(), key).toBeTruthy()
        expect(placeholders(value), key).toEqual(placeholders(source))
      }
    })
  }

  test("switching languages uses the loaded locale and its number formatting", async () => {
    await loadDictionary("ru")
    let locale: Locale = "en"
    const language = createLanguage(() => locale)
    expect(language.t("common.cancel")).toBe("Cancel")
    expect(language.number(1234.5)).toBe("1,234.5")
    locale = "ru"
    expect(language.t("common.cancel")).toBe("Отмена")
    expect(language.number(1234.5)).toBe("1\u00a0234,5")
    expect(language.plural("tui.footer.shells", 1000)).toContain("1\u00a0000")
  })

  test.each([
    [0, "0 субагентов"],
    [1, "1 субагент"],
    [2, "2 субагента"],
    [5, "5 субагентов"],
    [11, "11 субагентов"],
    [21, "21 субагент"],
    [22, "22 субагента"],
    [25, "25 субагентов"],
    [1.5, "1,5 субагента"],
  ])("Russian plural form for %s", async (count, expected) => {
    await loadDictionary("ru")
    const language = createLanguage(() => "ru")
    expect(language.plural("tui.footer.subagents", count)).toBe(expected)
  })
})

function placeholders(value: string | undefined) {
  return [...new Set(Array.from((value ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g), (match) => match[1]))].sort()
}
