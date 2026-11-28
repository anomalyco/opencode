import { tag, type Locale } from "~/lib/language"
import { latestDocs } from "../config"
import { docsAlternates, docsLocaleHref, docsSections } from "./navigation"

/**
 * The latest docs' sitemap: every English page, and every language version that has a translation,
 * each listing the same alternates (its translated languages and English, with English as
 * x-default). Fallback pages are left out: they canonicalise to the English page (route.ts,
 * DocsLayout.tsx). The V1 docs are noindex and have no sitemap.
 */
export function renderSitemap(
  site: URL,
  translated: ReadonlyMap<string, readonly Locale[]> = new Map(),
  pages: readonly string[] = docsSections.flatMap((section) =>
    section.groups.flatMap((group) => group.items.map((item) => item.slug)),
  ),
) {
  const slugs = [...new Set(pages)].toSorted()
  const urls = slugs.flatMap((slug) => {
    const alternates = docsAlternates(slug, translated)
    const links = [
      ...alternates.map((locale) => ({
        hreflang: tag(locale),
        href: new URL(docsLocaleHref(slug, latestDocs, locale), site).href,
      })),
      { hreflang: "x-default", href: new URL(docsLocaleHref(slug, latestDocs, "en"), site).href },
    ]
    const listed = alternates.map((locale) => ({
      href: new URL(docsLocaleHref(slug, latestDocs, locale), site).href,
      links,
    }))
    return listed
  })

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    ...urls.map(
      (url) =>
        `  <url><loc>${escape(url.href)}</loc>${url.links
          .map((link) => `<xhtml:link rel="alternate" hreflang="${link.hreflang}" href="${escape(link.href)}"/>`)
          .join("")}</url>`,
    ),
    `</urlset>`,
  ].join("\n")
}

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
