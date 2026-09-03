import { describe, expect, test } from "bun:test"
import { desktopNativePluralCategories } from "./desktop-native"

const appLocales = [
  "ar",
  "br",
  "bs",
  "da",
  "de",
  "es",
  "fr",
  "ja",
  "ko",
  "no",
  "pl",
  "ru",
  "uk",
  "th",
  "tr",
  "zh",
  "zht",
  "hi",
  "nl",
  "id",
  "vi",
  "it",
  "ur",
  "pa",
  "az",
  "fi",
  "sv",
  "am",
  "bg",
  "bn",
  "ca",
  "cs",
  "dv",
  "dz",
  "el",
  "et",
  "fa",
  "fo",
  "hr",
  "hu",
  "hy",
  "is",
  "ka",
  "km",
  "lo",
  "lt",
  "lv",
  "mk",
  "mn",
  "ms",
  "my",
  "ne",
  "ro",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "tg",
  "tk",
  "uz",
] as const
const desktopLocales = appLocales
const pluralCategories = new Map(
  appLocales.map(
    (locale) =>
      [
        locale,
        desktopNativePluralCategories(locale).filter((category) => category !== "one" && category !== "other"),
      ] as const,
  ),
)

const domains = [
  {
    name: "app",
    source: "./en.ts",
    target: (locale: string) => `./${locale}.ts`,
    locales: appLocales,
  },
  {
    name: "ui",
    source: "../../../ui/src/i18n/en.ts",
    target: (locale: string) => `../../../ui/src/i18n/${locale}.ts`,
    locales: appLocales,
  },
  {
    name: "desktop",
    source: "../../../desktop/src/renderer/i18n/en.ts",
    target: (locale: string) => `../../../desktop/src/renderer/i18n/${locale}.ts`,
    locales: desktopLocales,
  },
] as const

describe("i18n parity", () => {
  test("non-English locales have every English key and required plural variants", async () => {
    for (const domain of domains) {
      const source = await dictionary(domain.source)
      for (const locale of domain.locales) {
        const target = await dictionary(domain.target(locale))
        const missing = Object.keys(source).filter((key) => !Object.hasOwn(target, key))
        const extra = Object.keys(target)
          .filter((key) => !Object.hasOwn(source, key))
          .sort()
        const expected = pluralFamilies(source)
          .flatMap((key) => (pluralCategories.get(locale) ?? []).map((category) => `${key}.${category}`))
          .sort()
        expect({ domain: domain.name, locale, missing, extra }).toEqual({
          domain: domain.name,
          locale,
          missing: [],
          extra: expected,
        })
      }
    }
  })

  test("non-English locales preserve English placeholders", async () => {
    for (const domain of domains) {
      const source = await dictionary(domain.source)
      for (const locale of domain.locales) {
        const target = await dictionary(domain.target(locale))
        const mismatched = Object.keys(source).filter(
          (key) => Object.hasOwn(target, key) && placeholders(source[key]).join() !== placeholders(target[key]).join(),
        )
        const pluralMismatched = pluralFamilies(source).flatMap((key) =>
          (pluralCategories.get(locale) ?? [])
            .map((category) => `${key}.${category}`)
            .filter((variant) => placeholders(source[`${key}.other`]).join() !== placeholders(target[variant]).join()),
        )
        expect({ domain: domain.name, locale, mismatched, pluralMismatched }).toEqual({
          domain: domain.name,
          locale,
          mismatched: [],
          pluralMismatched: [],
        })
      }
    }
  })

  test("non-English locales translate targeted unseen session keys", async () => {
    const source = await dictionary("./en.ts")
    for (const locale of appLocales) {
      const target = await dictionary(`./${locale}.ts`)
      for (const key of ["command.session.previous.unseen", "command.session.next.unseen"]) {
        expect(target[key]).toBeDefined()
        expect(target[key]).not.toBe(source[key])
      }
    }
  })

  test("changed-file summary keys preserve rendered English copy and localize complete phrases", async () => {
    const source = await dictionary("../../../ui/src/i18n/en.ts")
    expect(source["ui.sessionTurn.diffs.changed.one"].replace("{{count}}", "1")).toBe("1 Changed file")
    expect(source["ui.sessionTurn.diffs.changed.other"].replace("{{count}}", "2")).toBe("2 Changed files")
    expect(source["ui.sessionTurn.diffs.changed"]).toBeUndefined()

    for (const locale of appLocales) {
      const target = await dictionary(`../../../ui/src/i18n/${locale}.ts`)
      for (const key of ["ui.sessionTurn.diffs.changed.one", "ui.sessionTurn.diffs.changed.other"]) {
        expect(target[key].trim()).not.toBe("")
        expect(placeholders(target[key])).toEqual(["count"])
      }
    }
  })

  test("UI rich templates keep exactly one typed slot", async () => {
    const expected = {
      "ui.lineComment.label": "selection",
      "ui.lineComment.editorLabel": "selection",
      "ui.list.emptyWithFilter": "query",
    } as const
    const legacy = Object.keys(expected).flatMap((key) => [`${key}.prefix`, `${key}.suffix`])

    for (const locale of ["en", ...appLocales]) {
      const target = await dictionary(`../../../ui/src/i18n/${locale}.ts`)
      for (const [key, slot] of Object.entries(expected)) {
        expect({ locale, key, placeholders: placeholders(target[key]) }).toEqual({ locale, key, placeholders: [slot] })
      }
      expect({ locale, legacy: legacy.filter((key) => Object.hasOwn(target, key)) }).toEqual({ locale, legacy: [] })
    }
  })
})

describe("i18n plural parity", () => {
  test("locale-specific categories exist and preserve count placeholders", async () => {
    for (const domain of domains.slice(0, 2)) {
      const source = await dictionary(domain.source)
      const families = pluralFamilies(source)
      for (const locale of domain.locales) {
        const target = await dictionary(domain.target(locale))
        const missing = families.flatMap((key) =>
          (pluralCategories.get(locale) ?? [])
            .map((category) => `${key}.${category}`)
            .filter((variant) => !Object.hasOwn(target, variant)),
        )
        const mismatched = families.flatMap((key) =>
          (pluralCategories.get(locale) ?? [])
            .map((category) => `${key}.${category}`)
            .filter(
              (variant) =>
                Object.hasOwn(target, variant) &&
                placeholders(source[`${key}.other`]).join() !== placeholders(target[variant]).join(),
            ),
        )
        expect({ domain: domain.name, locale, missing, mismatched }).toEqual({
          domain: domain.name,
          locale,
          missing: [],
          mismatched: [],
        })
      }
    }
  })
})

async function dictionary(file: string) {
  const module: unknown = await import(file)
  if (typeof module !== "object" || module === null || !("dict" in module) || !isDictionary(module.dict)) {
    throw new Error(`Invalid translation dictionary: ${file}`)
  }
  return module.dict
}

function isDictionary(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

function placeholders(value: string) {
  return Array.from(value.matchAll(/{{\s*([^}]+?)\s*}}/g), (match) => match[1]).sort()
}

function pluralFamilies(dictionary: Record<string, string>) {
  return Object.keys(dictionary)
    .filter(
      (key) =>
        key.endsWith(".one") &&
        dictionary[key].includes("{{count}}") &&
        dictionary[`${key.slice(0, -4)}.other`]?.includes("{{count}}"),
    )
    .map((key) => key.slice(0, -4))
}
