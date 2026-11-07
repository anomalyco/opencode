import { base, files } from "./config"
import { docsHref } from "./lib/navigation"

/**
 * What a request under /docs gets, given the docs' page slugs (`virtual:docs-pages`, the list the
 * build prerenders): one of the docs' own files, a page or its Markdown twin, or a redirect. Any path
 * that isn't a page here was a V1 docs page, which may have had another language (/docs/ja/...), so
 * it goes to the same path on the V1 docs, temporarily, because V2 may add the page later. Undefined
 * outside /docs.
 */
export function docsRoute(url: URL, accept: string, slugs: readonly string[]) {
  // Agents try a page's URL plus .md first, which for the intro is /docs.md.
  const pathname = url.pathname === "/docs.md" ? `${base}index.md` : url.pathname
  if (!pathname.startsWith(base) && pathname !== base.slice(0, -1)) return
  const path = pathname.slice(base.length - 1)
  if (files.includes(path.split("/")[1] ?? "")) return { type: "file" as const, path }

  const file = path.endsWith(".md")
  const page = file ? path.slice(0, -3) : path
  const slug = page.replace(/^\/|\/$/g, "") || "index"
  const target = moved.get(slug)
  if (target) return redirect(docsHref(target), 301)
  if (!slugs.includes(slug)) return redirect(`/v1/docs${path}${url.search}`, 302)
  const canonical = docsHref(slug)
  if (!file && path.endsWith("/") && !canonical.endsWith("/")) return redirect(canonical, 307)
  // The API reference has no Markdown twin.
  const twin = slug !== "api"
  const markdown = file || (twin && (accept.includes("text/markdown") || accept.includes("text/x-markdown")))
  if (markdown && !twin) return { type: "missing" as const }
  return { type: "page" as const, slug, markdown, twin }
}

// Pages that moved, by slug: V2's own move, and V1's Go and Zen pages, which became Console pages.
const moved = new Map([
  ["console/inference", "console/api/inference"],
  ["go", "console/go"],
  ["zen", "console/models"],
])

function redirect(location: string, status: number) {
  return { type: "redirect" as const, location, status }
}
