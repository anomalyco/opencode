interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

export type DocsLinks = {
  /** The page's docs base: `/docs` in English, `/<locale>/docs` in a translated page. */
  base: string
  /** The set's English base, where its shared files (assets, openapi.json, …) live. */
  setBase: string
  /** The set's page slugs, so only links to docs pages are localized. */
  pages: ReadonlySet<string>
  /** The set's own file names (`assets`, `openapi.json`, …), which stay under the English base. */
  files: readonly string[]
}

/**
 * Where a root-relative link in a docs page goes: a docs page takes the page's language prefix, a
 * docs file stays under the English set base (assets and schemas are not translated), and every
 * other root-relative path (a site page, a path outside the docs) is left as written.
 */
export function docsLink(url: string, options: DocsLinks) {
  if (!url.startsWith("/") || url.startsWith("//")) return
  const path = url.split(/[?#]/)[0].replace(/\/+$/, "")
  const slug = path.replace(/^\/+/, "")
  const base =
    slug === "" || slug === "index" || options.pages.has(slug)
      ? options.base
      : options.files.includes(slug.split("/")[0])
        ? options.setBase
        : undefined
  return base === undefined ? undefined : `${base.replace(/\/$/, "")}${url}`
}

export default function remarkDocsLinks(options: DocsLinks) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "link" && node.url) node.url = docsLink(node.url, options) ?? node.url
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}
