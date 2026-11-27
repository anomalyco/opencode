import { describe, expect, test } from "bun:test"
import { tag } from "~/lib/language"
import { latestDocs } from "../src/docs/config"
import {
  docsAlternates,
  docsCanonicalHref,
  docsLanguageAlternates,
  docsLocaleHref,
  docsLocaleMarkdownHref,
  docsPagefindHref,
  docsTranslation,
} from "../src/docs/lib/navigation"
import { renderSitemap } from "../src/docs/lib/sitemap"

describe("latest docs languages", () => {
  test("English keeps the set's base and the rest take the site's prefix", () => {
    expect(docsLocaleHref("config", latestDocs, "en")).toBe("/docs/config/")
    expect(docsLocaleHref("index", latestDocs, "en")).toBe("/docs/")
    expect(docsLocaleHref("config", latestDocs, "zh")).toBe("/zh/docs/config/")
    expect(docsLocaleHref("index", latestDocs, "ar")).toBe("/ar/docs/")
    expect(docsLocaleHref("api", latestDocs, "zh")).toBe("/zh/docs/api")
  })

  test("a page's Markdown twin and search index live in its language too", () => {
    expect(docsLocaleMarkdownHref("index", latestDocs, "zh")).toBe("/zh/docs/index.md")
    expect(docsLocaleMarkdownHref("config", latestDocs, "zh")).toBe("/zh/docs/config.md")
    expect(docsPagefindHref(latestDocs, "zh")).toBe("/zh/docs/pagefind/pagefind.js")
    expect(docsPagefindHref(latestDocs, "en")).toBe("/docs/pagefind/pagefind.js")
  })

  test("a translation is a locale folder with the English file's path", () => {
    expect(docsTranslation("zh/index.mdx")).toEqual({ locale: "zh", slug: "index" })
    expect(docsTranslation("zht/build/plugins/server.mdx")).toEqual({ locale: "zht", slug: "build/plugins/server" })
    expect(docsTranslation("zh/foo/index.mdx")).toEqual({ locale: "zh", slug: "foo" })
    expect(docsTranslation("index.mdx")).toBeUndefined()
    expect(docsTranslation("build/plugins/server.mdx")).toBeUndefined()
    // A file named like a language is still an English page.
    expect(docsTranslation("zh.mdx")).toBeUndefined()
  })

  test("alternates list English and the languages with a translation, in the site's order", () => {
    const translated = new Map([["instructions", ["zh", "ja"] as const]])
    expect(docsAlternates("instructions", translated)).toEqual(["en", "zh", "ja"])
    expect(docsAlternates("config", translated)).toEqual(["en"])
  })

  test("a fallback page canonicalises to English; a translated page to itself", () => {
    expect(docsCanonicalHref("instructions", latestDocs, "zh", true)).toBe("/zh/docs/instructions/")
    expect(docsCanonicalHref("instructions", latestDocs, "zh", false)).toBe("/docs/instructions/")
    expect(docsCanonicalHref("instructions", latestDocs, "en", true)).toBe("/docs/instructions/")
  })
})

describe("docs sitemap", () => {
  const site = new URL("https://opencode.ai")
  const xml = renderSitemap(site, new Map([["instructions", ["zh"] as const]]))
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(.*?)<\/url>/g)].map((match) => ({
    loc: match[1],
    links: [...match[2].matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((link) => ({
      hreflang: link[1],
      href: link[2],
    })),
  }))
  const at = (path: string) => urls.find((url) => new URL(url.loc).pathname === path)

  test("lists each page in every language that has a translation, with the shared alternates", () => {
    expect(at("/docs/instructions/")?.links).toEqual([
      { hreflang: "en", href: "https://opencode.ai/docs/instructions/" },
      { hreflang: "zh-Hans", href: "https://opencode.ai/zh/docs/instructions/" },
      { hreflang: "x-default", href: "https://opencode.ai/docs/instructions/" },
    ])
    expect(at("/zh/docs/instructions/")?.links).toEqual(at("/docs/instructions/")?.links)
  })

  test("leaves fallback pages and untranslated languages out", () => {
    expect(at("/zh/docs/config/")).toBeUndefined()
    expect(at("/docs/config/")?.links).toEqual([
      { hreflang: "en", href: "https://opencode.ai/docs/config/" },
      { hreflang: "x-default", href: "https://opencode.ai/docs/config/" },
    ])
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
  })

  test("a page head lists the sitemap's alternates, including English and itself", () => {
    // render.tsx passes docsLanguageAlternates(...) to DocsLayout, which adds x-default.
    const head = (locales: Parameters<typeof docsLanguageAlternates>[0]) => [
      ...docsLanguageAlternates(locales).map((locale) => tag(locale)),
      "x-default",
    ]
    const sitemap = (path: string) => at(path)!.links.map((link) => link.hreflang)
    // The translated page and its English page list the same set, en and zh-Hans, themselves included.
    expect(head(["zh"])).toEqual(["en", "zh-Hans", "x-default"])
    expect(head(["zh"])).toEqual(sitemap("/docs/instructions/"))
    expect(head(["zh"])).toEqual(sitemap("/zh/docs/instructions/"))
    // An English page without a translation lists itself and x-default.
    expect(head([])).toEqual(sitemap("/docs/config/"))
    // A non-English fallback canonicalises to English and lists English only, not its own locale.
    expect(head([])).toEqual(["en", "x-default"])
  })
})
