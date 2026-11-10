import { renderToString } from "solid-js/web"
import { docsSets, latestDocs, v1Docs, type DocsSet } from "./config"
import { docsContent } from "./content"
import { DocsDocument } from "./document"
import type { DocsAssets } from "./layouts/DocsLayout"
import { docsHref } from "./lib/navigation"
import { latestHref, v1Href, v1Locales, v1Page, v1Section, v1Slug, type V1Locale } from "./lib/v1-navigation"

export { renderLlmsTxt } from "./lib/llms"
export { renderSitemap } from "./lib/sitemap"

// The docs' renderer: script/build.ts prerenders every page with it, and the development server
// renders on request (middleware.ts). The Worker never renders docs.

/** Every docs page's slug, by set: the content pages, and the latest docs' API reference. */
export const docsSlugs = Object.fromEntries(
  docsSets.map((set) => [
    set.id,
    [...docsContent.get(set.id)!.keys(), ...(set.id === "latest" ? ["api"] : [])].toSorted(),
  ]),
) as Record<DocsSet["id"], string[]>

/** A docs page as HTML, or undefined when there is no such page. */
export async function renderDocsPage(set: DocsSet, slug: string, assets: DocsAssets) {
  if (!docsSlugs[set.id].includes(slug)) return
  const module = await docsContent.get(set.id)!.get(slug)?.()
  const { locale, page } = v1Page(slug)
  const versions =
    set.id === "v1"
      ? { latest: latestHref(page, docsSlugs.latest), v1: docsHref(slug, v1Docs) }
      : { latest: docsHref(slug, latestDocs), v1: v1Href(slug, docsSlugs.v1) }
  const v1 =
    set.id === "v1"
      ? {
          locale,
          section: v1Section(locale, await v1Titles(locale)),
          languages: languages(page),
          anchor: anchor(slug, await v1Ids()),
        }
      : undefined
  return renderToString(() => (
    <DocsDocument set={set} slug={slug} module={module} assets={assets} versions={versions} v1={v1} />
  ))
}

/** A content page's Markdown twin, or undefined when it has none. */
export async function renderDocsMarkdown(set: DocsSet, slug: string) {
  return (await docsContent.get(set.id)!.get(slug)?.())?.markdown
}

/** The V1 docs' English section, for their llms.txt. */
export async function v1EnglishSection() {
  return v1Section(v1Locales[0], await v1Titles(v1Locales[0]))
}

/** The titles of the V1 pages in a language, by English slug, which name them in its sidebar. */
async function v1Titles(locale: V1Locale) {
  const pages = [...docsContent.get("v1")!].filter(([slug]) => v1Page(slug).locale === locale)
  return new Map(
    await Promise.all(
      pages.map(async ([slug, load]) => [v1Page(slug).page, (await load()).frontmatter.title] as const),
    ),
  )
}

// Every V1 page's heading ids, by slug, loaded once.
let ids: Promise<Map<string, string[]>> | undefined
const v1Ids = () =>
  (ids ??= Promise.all(
    [...docsContent.get("v1")!].map(
      async ([slug, load]) => [slug, (await load()).headings.map((h) => h.slug)] as const,
    ),
  ).then((entries) => new Map(entries)))

/**
 * A V1 link's anchor (remark-starlight.ts) on the page it goes to: Starlight's links name English
 * headings, so on a page in another language it's the heading in the same place there, when the page
 * has the same headings as in English, or else the top of the page.
 */
function anchor(slug: string, ids: Map<string, string[]>) {
  return (href: string) => {
    const [path, hash] = href.split("#")
    if (hash === undefined || (path && !path.startsWith(v1Docs.base))) return href
    const target = path ? path.slice(v1Docs.base.length).replace(/\/$/, "") || "index" : slug
    const own = ids.get(target) ?? []
    const id = decodeURIComponent(hash)
    if (own.includes(id)) return href
    const english = ids.get(v1Page(target).page) ?? []
    const moved = english.length === own.length ? own[english.indexOf(id)] : undefined
    return moved ? `${path}#${moved}` : path || docsHref(slug, v1Docs)
  }
}

/** A V1 page in every language: there, or that language's intro where it has no such page. */
function languages(page: string) {
  return v1Locales.map((locale) => {
    const slug = v1Slug(locale, page)
    return { ...locale, href: docsHref(docsSlugs.v1.includes(slug) ? slug : v1Slug(locale, "index"), v1Docs) }
  })
}
