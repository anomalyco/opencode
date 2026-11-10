import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { v1Locales, v1Section } from "~/docs/lib/v1-navigation"
import { dict as en } from "~/i18n/en"

// The V1 docs in their Starlight app's folders (src/docs/config.ts), English at the root.
const content = path.resolve(import.meta.dir, "../../../packages/web/src/content/docs")
const pages = (folder: string) =>
  readdirSync(path.join(content, folder))
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.replace(/\.mdx$/, ""))
    .toSorted()
// Docs words some languages write as English does ("Terminal" in German, "Tip" in Danish, "Pages" in French).
const shared = new Set(["Terminal", "Diff", "Note", "Tip", "Danger", "Documentation", "Pages"])
const docsKeys = Object.keys(en).filter((key) => key.startsWith("docs.")) as (keyof typeof en)[]

describe("V1 docs in every language", () => {
  for (const locale of v1Locales.filter((locale) => locale.path)) {
    test(`${locale.path} has every English page, all in its sidebar`, () => {
      expect(pages(locale.path)).toEqual(pages(""))
      const titles = new Map(
        pages(locale.path).map((page) => {
          const source = readFileSync(path.join(content, locale.path, `${page}.mdx`), "utf8")
          return [page, parse(source.split("---")[1]).title as string]
        }),
      )
      const slugs = v1Section(locale, titles).groups.flatMap((group) => group.items.map((item) => item.slug))
      expect(slugs).toContain(`${locale.path}/policies`)
      expect(slugs).toContain(`${locale.path}/references`)
    })

    test(`${locale.path} translates the docs' chrome`, async () => {
      const { dict } = (await import(`../src/i18n/${locale.site ?? locale.path}.ts`)) as { dict: typeof en }
      const english = docsKeys.filter((key) => dict[key] === en[key] && !shared.has(en[key]))
      expect(english).toEqual([])
    })
  }
})
