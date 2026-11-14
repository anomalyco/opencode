import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const placeholders = (value: string) =>
  [...value.matchAll(/\{\{([^{}]+)\}\}/g)]
    .map((match) => match[1].trim())
    .sort()
    .join(",")

const plugins = readdirSync(import.meta.dir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(import.meta.dir, entry.name, "i18n", "en.ts")) &&
      existsSync(join(import.meta.dir, entry.name, "i18n", "zh.ts")),
  )
  .map((entry) => entry.name)
  .sort()

const catalogs = await Promise.all(
  plugins.map(async (plugin) => {
    const [en, zh, definition] = await Promise.all([
      import(`./${plugin}/i18n/en`),
      import(`./${plugin}/i18n/zh`),
      import(`./${plugin}`),
    ])

    const source: Record<string, string> = en.default
    const translated: Record<string, string> = zh.default

    return {
      plugin,
      en: source,
      zh: translated,
      definition: definition.default,
    }
  }),
)

describe("Simplified Chinese built-in plugin catalogs", () => {
  for (const { plugin, en, zh, definition } of catalogs) {
    test(`${plugin} uses source keys and placeholders`, () => {
      const mismatched = Object.entries(zh).flatMap(([key, value]) => {
        if (!(key in en)) return [`${key} is not in en`]

        if (placeholders(en[key]) !== placeholders(value)) return [`${key} placeholders differ`]

        return []
      })

      expect(mismatched).toEqual([])
    })

    test(`${plugin} registers its zh catalog`, () => {
      expect(definition.i18n?.zh).toBeDefined()
    })
  }
})
