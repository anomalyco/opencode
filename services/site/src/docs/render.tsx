import { renderToString } from "solid-js/web"
import { docsSets, type DocsSet } from "./config"
import { docsContent } from "./content"
import { DocsDocument } from "./document"
import type { DocsAssets } from "./layouts/DocsLayout"

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
  return renderToString(() => <DocsDocument set={set} slug={slug} module={module} assets={assets} />)
}

/** A content page's Markdown twin, or undefined when it has none. */
export async function renderDocsMarkdown(set: DocsSet, slug: string) {
  return (await docsContent.get(set.id)!.get(slug)?.())?.markdown
}
