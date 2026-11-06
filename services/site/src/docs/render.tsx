import { renderToString } from "solid-js/web"
import { restyle } from "virtual:docs-pages"
import { docsContent } from "./content"
import { DocsDocument } from "./document"
import type { DocsAssets } from "./layouts/DocsLayout"
import { DocsDocument as LegacyDocsDocument } from "./legacy/document"

export { renderLlmsTxt } from "./lib/llms"
export { renderSitemap } from "./lib/sitemap"

// The docs' renderer: script/build.ts prerenders every page with it, and the development server
// renders on request (middleware.ts). The Worker never renders docs. The build's mode picks the
// restyle or the legacy pages (config.ts `restyled`).

/** Every docs page's slug: the content pages and the API reference. */
export const docsSlugs = [...docsContent.keys(), "api"].toSorted()

/** A docs page as HTML, or undefined when there is no such page. */
export async function renderDocsPage(slug: string, assets: DocsAssets) {
  const load = docsContent.get(slug)
  if (!load && slug !== "api") return
  const module = await load?.()
  const Document = restyle ? DocsDocument : LegacyDocsDocument
  return renderToString(() => <Document slug={slug} module={module} assets={assets} />)
}

/** A content page's Markdown twin, or undefined when it has none. */
export async function renderDocsMarkdown(slug: string) {
  return (await docsContent.get(slug)?.())?.markdown
}
