import { renderToString } from "solid-js/web"
import type { Locale } from "~/lib/language"
import { docsSets, latestDocs, latestDocsLocales, v1Docs, type DocsSet } from "./config"
import { docsContent, docsTranslations } from "./content"
import { DocsDocument, docsI18n } from "./document"
import type { DocsAssets } from "./layouts/DocsLayout"
import { currentTranslation } from "./lib/heading-structure"
import { docsHref, docsLanguageAlternates, docsLocaleHref, docsSectionTitles, getDocsSection } from "./lib/navigation"
import { renderSitemap } from "./lib/sitemap"
import { latestHref, v1Href, v1Locales, v1Page, v1Section, v1Slug, type V1Locale } from "./lib/v1-navigation"

export { renderLlmsTxt } from "./lib/llms"

// The docs' renderer: script/build.ts prerenders every page with it, and the development server
// renders on request (middleware.ts). The Worker never renders docs.

/** Every docs page's slug, by set: the content pages, and the latest docs' API reference. */
export const docsSlugs = Object.fromEntries(
  docsSets.map((set) => [
    set.id,
    [...docsContent.get(set.id)!.keys(), ...(set.id === "latest" ? ["api"] : [])].toSorted(),
  ]),
) as Record<DocsSet["id"], string[]>

/** Every language the pages are prerendered in, by set: the latest docs' languages, and English for V1 (its slugs carry theirs). */
export const docsPageLocales: Record<DocsSet["id"], readonly Locale[]> = { latest: latestDocsLocales, v1: ["en"] }

/** A docs page as HTML, or undefined when there is no such page. */
export async function renderDocsPage(set: DocsSet, slug: string, assets: DocsAssets, locale: Locale = "en") {
  if (!docsSlugs[set.id].includes(slug) || !docsPageLocales[set.id].includes(locale)) return
  const english = await docsContent.get(set.id)!.get(slug)?.()
  const translation =
    set.id === "latest" && locale !== "en"
      ? currentTranslation(await docsTranslations.get(locale)?.get(slug)?.())
      : undefined
  const module = translation ?? english
  const translated = translation !== undefined || locale === "en"
  const { locale: v1Locale, page } = v1Page(slug)
  const versions =
    set.id === "v1"
      ? { latest: latestHref(page, docsSlugs.latest), v1: docsHref(slug, v1Docs) }
      : { latest: docsLocaleHref(slug, latestDocs, locale), v1: v1Href(slug, docsSlugs.v1) }
  const v1 =
    set.id === "v1"
      ? {
          locale: v1Locale,
          section: v1Section(v1Locale, await v1Titles(v1Locale)),
          languages: languages(page),
          anchor: anchor(slug, await v1Ids()),
        }
      : undefined
  // The head lists the sitemap's languages: English and every current translation, the page
  // itself included. A non-English fallback page is not listed for its language and canonicals to
  // English, so its head lists English only.
  const translations = set.id === "latest" ? await translatedLocales(slug) : []
  const alternates =
    set.id === "latest" ? (translated ? docsLanguageAlternates(translations) : (["en"] as Locale[])) : []
  const section = v1?.section ?? (await localizedSection(slug, locale))
  return renderToString(() => (
    <DocsDocument
      set={set}
      slug={slug}
      module={module}
      assets={assets}
      locale={set.id === "latest" ? locale : "en"}
      translated={translated}
      alternates={alternates}
      section={section}
      versions={versions}
      v1={v1}
    />
  ))
}

/**
 * The current section in the page's language: UI labels from `docs.nav.*`, and each page's title
 * from its current translation's frontmatter. Untranslated or stale pages keep the English
 * navigation title; only translated pages load their module here.
 */
async function localizedSection(slug: string, locale: Locale) {
  const section = getDocsSection(slug)
  const titles = new Map<string, string>()
  if (locale !== "en") {
    const slugs = [
      ...new Set(section.groups.flatMap((group) => group.items.filter((item) => !item.href).map((item) => item.slug))),
    ]
    const found = await Promise.all(slugs.map(async (item) => [item, await translatedTitle(item, locale)] as const))
    for (const [item, title] of found) if (title) titles.set(item, title)
  }
  return docsSectionTitles(section, titles, (key) => docsI18n(locale).t(key))
}

const translatedTitleCache = new Map<string, Promise<string | undefined>>()
function translatedTitle(slug: string, locale: Locale) {
  const key = `${locale}/${slug}`
  const known = translatedTitleCache.get(key)
  if (known) return known
  const promise = (async () => {
    const module = currentTranslation(await docsTranslations.get(locale)?.get(slug)?.())
    return module?.frontmatter.title
  })()
  translatedTitleCache.set(key, promise)
  return promise
}

/**
 * The languages whose translation of a page is current: its file exists and its headings still
 * match the English page's (a stale translation is served as the English fallback, like a missing
 * one, and stays out of hreflang and the sitemap). Loaded once per page.
 */
const currentTranslations = new Map<string, Promise<Locale[]>>()
function translatedLocales(slug: string) {
  const known = currentTranslations.get(slug)
  if (known) return known
  const promise = Promise.all(
    [...docsTranslations].map(async ([locale, pages]) => {
      const load = pages.get(slug)
      if (!load) return
      return currentTranslation(await load()) ? locale : undefined
    }),
  ).then((locales) => locales.filter((locale): locale is Locale => locale !== undefined))
  currentTranslations.set(slug, promise)
  return promise
}

/** The latest docs' sitemap, with only the translations that are current (lib/sitemap.ts). */
export async function renderDocsSitemap(site: URL) {
  const translated = new Map<string, Locale[]>()
  for (const slug of docsSlugs.latest) translated.set(slug, await translatedLocales(slug))
  return renderSitemap(site, translated, docsSlugs.latest)
}

/**
 * A content page's Markdown twin, or undefined when it has none. A translated page serves its own
 * Markdown; a language without a translation serves the English page's. A V1 page's says under its
 * title, in its language, that it's the V1 docs and where the latest are.
 */
export async function renderDocsMarkdown(set: DocsSet, slug: string, locale: Locale = "en") {
  const translation =
    set.id === "latest" && locale !== "en"
      ? currentTranslation(await docsTranslations.get(locale)?.get(slug)?.())
      : undefined
  const markdown = (translation ?? (await docsContent.get(set.id)!.get(slug)?.()))?.markdown
  if (set.id !== "v1" || markdown === undefined) return markdown
  const note = docsI18n(v1Page(slug).locale).t("docs.v1.markdownNote")
  return markdown.replace(/\n\n/, `\n\n> ${note}\n\n`)
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

/** A V1 page in every language. */
function languages(page: string) {
  return v1Locales.map((locale) => ({ ...locale, href: docsHref(v1Slug(locale, page), v1Docs) }))
}
