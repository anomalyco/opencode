import { docsHref, docsSections } from "./navigation"

export function renderSitemap(site: URL) {
  const urls = new Set(
    docsSections.flatMap((section) =>
      section.groups.flatMap((group) => group.items.map((item) => new URL(docsHref(item.slug), site).href)),
    ),
  )

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...[...urls].map((url) => `  <url><loc>${url}</loc></url>`),
    `</urlset>`,
  ].join("\n")
}
