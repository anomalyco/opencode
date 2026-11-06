import { config } from "~/config"
import type { ChangelogRelease } from "~/lib/changelog"
import { changelogTimeline } from "~/lib/changelog-notes"
import { LOCALES, localized, route, tag } from "~/lib/language"
import { legalDocuments, legalVersions } from "~/lib/legal"

/**
 * /sitemap.xml is the one public sitemap, an index of the sitemaps below. Search engines read it from
 * robots.txt; the others are only listed here.
 */
export const sitemapFiles = [
  "/sitemap-pages.xml", // this app's pages, built below
  "/v2/sitemap.xml", // the V2 docs (src/docs)
  "/data/sitemap.xml", // the Data pages, from the stats app
  "/console/sitemap.xml", // the Console pages, from the Console app
]

/** The sitemaps as a sitemaps.org `sitemapindex`. */
export function sitemapIndexXml(files: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((file) => `<sitemap><loc>${escape(`${config.baseUrl}${file}`)}</loc></sitemap>`).join("\n")}
</sitemapindex>
`
}

/**
 * /sitemap-pages.xml lists every page route (SolidStart's route manifest, so a new page file is listed
 * without an edit here) in every locale, except the routes below. A route with parameters is listed
 * only through `dynamicRoutes`. test/sitemap.test.ts fails when a route is in neither list.
 * Keys are route paths as SolidStart writes them; `/x/*` also matches `/x`.
 */
export const sitemapExclusions: Record<string, string> = {
  "/*404": "the not-found page",
  "/devices": "a device preview tool, noindex",
  "/video-editor": "a development-only tool",
}

/** Routes with parameters, listed once per value from the data the page itself reads. */
const dynamicRoutes: Record<string, (data: SitemapData) => SitemapPage[]> = {
  "/changelog/:tag": (data) =>
    changelogTimeline(data.releases).map((entry) => ({
      path: `/changelog/${entry.releases[0].tag}`,
      lastmod: entry.date,
      englishOnly: true,
    })),
}

export type SitemapData = { releases: ChangelogRelease[] }

/** A page to list, by its path without the locale. English-only pages are listed once, at their English URL. */
export type SitemapPage = { path: string; englishOnly?: boolean; lastmod?: string }

/** The sitemaps.org limits for one file: 50,000 URLs and 50 MB uncompressed. */
export const sitemapLimits = { urls: 50_000, bytes: 50 * 1024 * 1024 }

/** Why a route is left out, or undefined when it is listed. */
export function sitemapExclusion(path: string) {
  const match = Object.entries(sitemapExclusions).find(([pattern]) =>
    pattern.endsWith("/*") ? path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1)) : path === pattern,
  )
  if (match) return match[1]
}

/** Page routes with parameters that are neither excluded nor in `dynamicRoutes`: the sitemap cannot list them. */
export function unlistedRoutes(routes: string[]) {
  return unique(routes.map(normalize)).filter(
    (path) => /[:*]/.test(path) && !sitemapExclusion(path) && !(path in dynamicRoutes),
  )
}

/** The pages to list, from the page routes' paths and the data behind the dynamic routes. */
export function sitemapPages(routes: string[], data: SitemapData): SitemapPage[] {
  return unique(routes.map(normalize))
    .toSorted()
    .filter((path) => !sitemapExclusion(path))
    .flatMap((path) => {
      if (path in dynamicRoutes) return dynamicRoutes[path](data)
      if (/[:*]/.test(path)) return []
      return [{ path, ...(localized(path) ? {} : { englishOnly: true }), ...details(path, data) }]
    })
}

/**
 * The pages as a sitemaps.org `urlset`, one `<url>` per locale with every locale as an hreflang
 * alternate. English-only pages are listed once, with en and x-default, as in their <head>.
 */
export function sitemapXml(pages: SitemapPage[]) {
  const url = (page: SitemapPage) => (locale: (typeof LOCALES)[number]) =>
    [
      `<url><loc>${escape(`${config.baseUrl}${route(locale, page.path)}`)}</loc>`,
      page.lastmod && `<lastmod>${page.lastmod}</lastmod>`,
      ...(page.englishOnly ? (["en"] as const) : LOCALES).map(
        (alternate) =>
          `<xhtml:link rel="alternate" hreflang="${tag(alternate)}" href="${escape(`${config.baseUrl}${route(alternate, page.path)}`)}"/>`,
      ),
      `<xhtml:link rel="alternate" hreflang="x-default" href="${escape(`${config.baseUrl}${page.path}`)}"/>`,
      "</url>",
    ]
      .filter(Boolean)
      .join("")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap((page) => (page.englishOnly ? [url(page)("en")] : LOCALES.map(url(page)))).join("\n")}
</urlset>
`
}

/** The legal pages are English only (as are the addresses that never take a locale); dates come from the releases and the legal text history. */
function details(path: string, data: SitemapData): Omit<SitemapPage, "path"> {
  if (path === "/changelog") return { lastmod: changelogTimeline(data.releases)[0]?.date }
  if (path === "/legal") {
    const dates = legalDocuments.flatMap((document) => legalVersions(document.path)[0]?.date ?? [])
    return { englishOnly: true, lastmod: dates.toSorted().at(-1) }
  }
  if (path.startsWith("/legal/")) return { englishOnly: true, lastmod: legalVersions(path)[0]?.date }
  return {}
}

/** SolidStart writes an index route as `/brand/`, and a layout and its index as `/x` and `/x/`. */
function normalize(path: string) {
  return path.length > 1 ? path.replace(/\/$/, "") : path
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function escape(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
