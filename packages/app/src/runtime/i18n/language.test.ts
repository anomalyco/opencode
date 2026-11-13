import { describe, expect, test } from "bun:test"
import { dict as enUi } from "@opencode/ui/i18n/en"
import { dict as zhUi } from "@opencode/ui/i18n/zh"
import { DESKTOP_NATIVE_LOCALES } from "./desktop-native"
import en from "./en"
import { localizedListParts, richTemplateParts } from "./language"
import zh from "./zh"

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

  test("keeps Simplified Chinese keys and placeholders aligned with English", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{([^{}]+)\}\}/g)]
        .map((match) => match[1].trim())
        .sort()
        .join(",")

    const english: Record<string, string> = en
    const englishUi: Record<string, string> = enUi

    const mismatched = [
      ...Object.entries(zh).flatMap(([key, value]) => {
        if (!(key in english)) return [`app:${key} is not in en`]

        if (placeholders(english[key]) !== placeholders(value)) return [`app:${key} placeholders differ`]

        return []
      }),
      ...Object.entries(zhUi).flatMap(([key, value]) => {
        if (!(key in englishUi)) return [`ui:${key} is not in en`]

        if (placeholders(englishUi[key]) !== placeholders(value)) return [`ui:${key} placeholders differ`]

        return []
      }),
    ]

    expect(mismatched).toEqual([])
  })
})
