import { describe, expect, test } from "bun:test"
import { createUiI18n, pluralCategory, type UiI18nSource } from "./i18n"

describe("pluralCategory", () => {
  test.each([
    ["en", 0, "other"],
    ["en", 1, "one"],
    ["fr", 0, "one"],
    ["fr", 1_000_000, "many"],
    ["ru", 1, "one"],
    ["ru", 2, "few"],
    ["ru", 5, "many"],
    ["ru", 21, "one"],
    ["ar", 0, "zero"],
    ["ar", 1, "one"],
    ["ar", 2, "two"],
    ["ar", 3, "few"],
    ["ar", 11, "many"],
    ["ar", 100, "other"],
    ["ja", 1, "other"],
  ] as const)("selects %s for %d as %s", (locale, count, expected) => {
    expect(pluralCategory(locale, count)).toBe(expected)
  })
})

describe("dynamic source copy", () => {
  const i18n = (locale: string, translated: string) => {
    const source: UiI18nSource = {
      locale: () => locale,
      t: () => translated,
      plural: () => "",
    }
    return createUiI18n(source)
  }

  test("keeps runtime copy for English locale tags", () => {
    expect(
      i18n("en-US", "Dictionary copy").tDynamic("dialog.usageExceeded.freeTier.title", "Runtime {{name}}", {
        name: "copy",
      }),
    ).toBe("Runtime copy")
  })

  test("uses dictionary copy for non-English locales", () => {
    expect(i18n("fr", "Texte traduit").tDynamic("dialog.usageExceeded.freeTier.title", "Runtime copy")).toBe(
      "Texte traduit",
    )
  })
})
