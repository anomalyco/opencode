import { describe, expect, test } from "bun:test"
import { DESKTOP_NATIVE_LOCALES } from "./desktop-native"
import { localizedListParts, richTemplateParts } from "./language"
import { dict as english } from "./en"
import { dict as russian } from "./ru"
import { dict as englishUi } from "@opencode/ui/i18n/en"
import { dict as russianUi } from "@opencode/ui/i18n/ru"
import { pluralCategory } from "@opencode/ui/context/i18n"

describe("rich translations", () => {
  test("lets the translated phrase position a rich slot", () => {
    const names = { type: "names" }
    expect(richTemplateParts("Written by {{names}}", { names })).toEqual(["Written by ", names])
    expect(richTemplateParts("{{names}} tarafından yazıldı", { names })).toEqual([names, " tarafından yazıldı"])
  })

  test("keeps list elements intact while localizing punctuation", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check is that no element was stringified
    expect(localizedListParts("en", items).filter((part) => typeof part !== "string")).toEqual(items)
  })
})

describe("dictionaries", () => {
  test("Russian app, native desktop and UI translations preserve English placeholders", () => {
    const source = new Map(Object.entries({ ...english, ...englishUi }))
    const translated = new Map(Object.entries({ ...russian, ...russianUi }))
    for (const [key, value] of source) {
      const translation = translated.get(key)
      if (translation === undefined) continue
      expect(placeholders(translation), key).toEqual(placeholders(value))
    }

    for (const [key, value] of translated) {
      if (!/\.(few|many)$/.test(key)) continue
      const original = source.get(key.replace(/\.(few|many)$/, ".other"))

      if (original === undefined) continue
      expect(placeholders(value), key).toEqual(placeholders(original))
    }
  })

  test.each([
    [0, "0 подключений"],
    [1, "1 подключение"],
    [2, "2 подключения"],
    [5, "5 подключений"],
    [11, "11 подключений"],
    [21, "21 подключение"],
    [22, "22 подключения"],
    [25, "25 подключений"],
    [1.5, "1.5 подключения"],
  ])("Russian connection count %s", (count, expected) => {
    const key = `dialog.provider.connections.count.${pluralCategory("ru-RU", count)}`
    const values: Record<string, string> = russian
    expect(values[key].replace("{{count}}", String(count))).toBe(expected)
  })

  test.each([
    [0, "0 провайдеров из Console станут недоступны."],
    [1, "1 провайдер из Console станет недоступен."],
    [2, "2 провайдера из Console станут недоступны."],
    [5, "5 провайдеров из Console станут недоступны."],
    [11, "11 провайдеров из Console станут недоступны."],
    [21, "21 провайдер из Console станет недоступен."],
    [22, "22 провайдера из Console станут недоступны."],
    [25, "25 провайдеров из Console станут недоступны."],
    [1.5, "1.5 провайдера из Console станут недоступны."],
  ])("Russian disconnect warning for %s providers", (count, expected) => {
    const key = `settings.providers.disconnect.consoleDescription.${pluralCategory("ru-RU", count)}`
    const values: Record<string, string> = russian
    expect(values[key].replace("{{count}}", String(count)).replace("{{workspace}}", "Console")).toBe(
      `Ваш вход будет удалён, а ${expected}`,
    )
  })

  test("are flat string maps in every locale", async () => {
    const modules = await Promise.all(
      DESKTOP_NATIVE_LOCALES.flatMap((locale) => [import(`./${locale}`), import(`../../../../ui/src/i18n/${locale}`)]),
    )

    const nested = modules.flatMap((module) =>
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the check is that no value is nested
      Object.entries<unknown>(module.dict).filter(([, value]) => typeof value !== "string"),
    )

    expect(nested).toEqual([])
  })
})

function placeholders(value: string) {
  return Array.from(value.matchAll(/\{\{\s*(\w+)\s*\}\}/g), (match) => match[1]).sort()
}
