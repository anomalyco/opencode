import { describe, expect, test } from "bun:test"
import { createUiI18n, localizedListSeparator, pluralCategory, resolveTemplate, type UiI18nSource } from "./i18n"

const i18n = (locale: string, translated: string) => {
  const source: UiI18nSource = {
    locale: () => locale,
    t: () => translated,
    plural: () => "",
  }

  return createUiI18n(source)
}

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

describe("localizedListSeparator", () => {
  test("uses locale list punctuation and conjunctions", () => {
    expect(localizedListSeparator("en", 1, 3)).toBe(", ")
    expect(localizedListSeparator("en", 2, 3)).toBe(", and ")
    expect(localizedListSeparator("de", 1, 2)).toBe(" und ")
  })

  test("formats a complete localized list", () => {
    expect(i18n("en", "").list(["Read", "Search", "List"])).toBe("Read, Search, List")
    expect(i18n("en-US", "").list(["Read", "Search"])).toBe("Read, Search")
    expect(i18n("en", "").listSeparator(2, 3)).toBe(",")
    expect(i18n("de", "").list(["Lesen", "Suchen"])).toBe("Lesen und Suchen")
  })
})

describe("resolveTemplate", () => {
  test("fills params with optional inner spacing and repeats", () => {
    expect(resolveTemplate("Hello {{name}}, {{ name }} and {{  other  }}", { name: "Ada", other: 2 })).toBe(
      "Hello Ada, Ada and 2",
    )
  })

  test("stringifies numbers and booleans, including zero and false", () => {
    expect(resolveTemplate("{{count}} {{done}}", { count: 0, done: false })).toBe("0 false")
  })

  test("returns the text untouched without params", () => {
    expect(resolveTemplate("Hello {{name}}")).toBe("Hello {{name}}")
  })

  test("does not treat $ in a value as a replacement pattern", () => {
    expect(resolveTemplate("file {{name}}", { name: "a$&b$1" })).toBe("file a$&b$1")
  })

  test("blanks a placeholder whose param is missing", () => {
    expect(resolveTemplate("a {{missing}} b", { other: "x" })).toBe("a  b")
  })
})
