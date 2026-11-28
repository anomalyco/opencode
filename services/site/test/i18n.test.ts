import { expect, test } from "bun:test"
import { checkLocale } from "~/i18n/check"
import { LOCALES } from "~/lib/language"

// Every locale keeps the English keys and, in each translation, the English {{params}}, link ids and
// code spans (src/i18n/check.ts, which also lists what is left to translate).
for (const locale of LOCALES.slice(1) as Exclude<(typeof LOCALES)[number], "en">[]) {
  test(`${locale} matches the English keys, params, link ids and code spans`, async () => {
    expect((await checkLocale(locale)).errors).toEqual([])
  })
}

test("dictionary-backed page copy needs only the dictionary stamp", async () => {
  const report = await checkLocale("ja")
  const question = "content:download.faq.items.what-is-opencode.question"
  expect(report.untranslated).not.toContain(question)
  expect(report.stamps).not.toHaveProperty(question)
  expect(report.stamps["home.faq.q1"]).toBeDefined()
})
