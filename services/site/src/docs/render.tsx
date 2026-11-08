import { renderToString } from "solid-js/web"
import { docsContent } from "./content"
import { DocsDocument } from "./document"
import type { DocsAssets } from "./layouts/DocsLayout"

export { renderLlmsTxt } from "./lib/llms"
export { renderSitemap } from "./lib/sitemap"

// The docs' renderer: script/build.ts prerenders every page with it, and the development server
// renders on request (middleware.ts). The Worker never renders docs.

/** Every docs page's slug: the content pages and the API reference. */
export const docsSlugs = [...docsContent.keys(), "api"].toSorted()

/** A docs page as HTML, or undefined when there is no such page. */
export async function renderDocsPage(slug: string, assets: DocsAssets) {
  const load = docsContent.get(slug)
  if (!load && slug !== "api") return
  const module = await load?.()
  return renderToString(() => <DocsDocument slug={slug} module={module} assets={assets} />)
}

/** A content page's Markdown twin, or undefined when it has none. */
export async function renderDocsMarkdown(slug: string) {
  return (await docsContent.get(slug)?.())?.markdown
}
