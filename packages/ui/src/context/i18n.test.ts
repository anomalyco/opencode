import { describe, expect, test } from "bun:test"
import { createUiI18n, pluralCategory, pluralKey, type UiI18nParams, type UiI18nSource } from "./i18n"

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

function i18n(locale: string, messages: Record<string, string>) {
  const source: UiI18nSource = {
    locale: () => locale,
    t: (key, params) => resolve(messages[key] ?? key, params),
    plural: (key, count, params) =>
      source.t(pluralKey(key, pluralCategory(source.locale(), count)), { ...params, count }),
  }
  return createUiI18n(source)
}

function resolve(template: string, params?: UiI18nParams) {
  if (!params) return template
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_, key) => String(params[String(key)] ?? ""))
}

describe("createUiI18n", () => {
  test("keeps dynamic source copy for English locale tags", () => {
    const value = i18n("en-US", { title: "Dictionary title" })
    expect(value.tDynamic("title", "Runtime {{name}}", { name: "title" })).toBe("Runtime title")
  })

  test("uses dictionary copy for non-English locales", () => {
    const value = i18n("fr", { title: "Titre traduit" })
    expect(value.tDynamic("title", "Runtime title")).toBe("Titre traduit")
  })

  test("inserts rich values in dictionary order", () => {
    const value = i18n("ja", {
      "ui.lineComment.label": "{{selection}}へのコメント",
      "ui.lineComment.editorLabel": "Commenting on {{selection}}",
      "ui.list.emptyWithFilter": "没有关于{{query}}的结果",
    })
    const selection = { id: "selection" }
    expect(value.parts("ui.lineComment.label", { selection })).toEqual(["", selection, "へのコメント"])
    expect(value.parts("ui.list.emptyWithFilter", { query: "needle" })).toEqual(["没有关于", "needle", "的结果"])
  })

  test("rejects malformed rich templates", () => {
    const value = i18n("en", { "ui.lineComment.label": "Comment" })
    expect(() => value.parts("ui.lineComment.label", { selection: "path" })).toThrow()
  })

  test("selects plural copy before inserting the animated count", () => {
    const value = i18n("ar", {
      "ui.messagePart.context.read.two": "تمت قراءة ملفين: {{count}} في {{folder}}",
    })
    const count = { id: "animated-count" }
    expect(value.pluralParts("ui.messagePart.context.read", 2, { count }, { folder: "src" })).toEqual([
      "تمت قراءة ملفين: ",
      count,
      " في src",
    ])
  })
})
