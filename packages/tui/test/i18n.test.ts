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
      for (const [key, value] of Object.entries(en)) {
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
    await loadDictionary("de")
    let locale: Locale = "en"
    const language = createLanguage(() => locale)
    expect(language.t("common.cancel")).toBe("Cancel")
    expect(language.number(1234.5)).toBe("1,234.5")
    locale = "de"
    expect(language.t("common.cancel")).toBe("Abbrechen")
    expect(language.number(1234.5)).toBe("1.234,5")
    expect(language.plural("tui.footer.shells", 1000)).toContain("1.000")
  })

  test("Polish selects singular, few, and many plural forms", async () => {
    await loadDictionary("pl")
    const language = createLanguage(() => "pl")
    expect(language.plural("tui.footer.subagents", 1)).toBe("1 subagent")
    expect(language.plural("tui.footer.subagents", 2)).toBe("2 subagenci")
    expect(language.plural("tui.footer.subagents", 5)).toBe("5 subagentów")
  })
})

function placeholders(value: string | undefined) {
  return [...new Set(Array.from((value ?? "").matchAll(/\{\{\s*(\w+)\s*\}\}/g), (match) => match[1]))].sort()
}
