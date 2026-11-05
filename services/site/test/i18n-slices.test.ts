import { expect, test } from "bun:test"
import path from "node:path"
import { readFileSync } from "node:fs"
import { result } from "../script/i18n-slices"
import { dict as en } from "~/i18n/en"
import { LOCALES } from "~/lib/language"

const src = path.join(import.meta.dir, "../src")

test("every page route is a boundary with its own slice", () => {
  const routes = [...new Bun.Glob("routes/**/*.tsx").scanSync(src)]
    .map((file) => path.join(src, file))
    .filter((file) => readFileSync(file, "utf8").includes("export default"))
  expect(routes.length).toBeGreaterThan(10)
  expect(routes.filter((file) => !result.boundaries[file])).toEqual([])
})

test("every locale has a value for every key its slices name", () => {
  for (const locale of LOCALES) {
    const slices = result.locales[locale].slices
    for (const id of Object.values(result.shared)) expect(slices[id]).toBeDefined()
    for (const payload of [...Object.values(slices), result.locales[locale].full])
      expect(Object.entries(payload.dict).filter(([, value]) => typeof value !== "string")).toEqual([])
  }
})

test("a language's full file has everything its slices have", () => {
  for (const locale of LOCALES) {
    const full = result.locales[locale].full
    for (const payload of Object.values(result.locales[locale].slices)) {
      expect(Object.keys(payload.dict).filter((key) => !(key in full.dict))).toEqual([])
      expect(Object.keys(payload.content).filter((area) => !(area in full.content))).toEqual([])
    }
  }
})

test("English slices carry no page copy, and the English for the copy source is English", () => {
  for (const payload of Object.values(result.locales.en.slices)) expect(payload.content).toEqual({})
  for (const [key, value] of Object.entries(result.english)) expect(value).toBe((en as Record<string, string>)[key])
})
