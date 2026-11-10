import { createMiddleware } from "@solidjs/start/middleware"
import { assets } from "#resource"
import { config } from "~/config"
import { securityHeaders, setSecurityHeaders } from "~/lib/security-headers"
import type { DocsSet } from "./config"
import { docsSlugs } from "virtual:docs-pages"
import { renderLlmsTxt } from "./lib/llms"
import { docsHref, docsMarkdownHref } from "./lib/navigation"
import { renderSitemap } from "./lib/sitemap"
import { docsRoute } from "./route"

// Everything under /docs. Docs pages and their Markdown twins are static assets prerendered at build
// (script/build.ts). Docs URLs come here first (cloudflare.config.ts runWorkerFirst), so one URL can
// answer with the page or, to `Accept: text/markdown`, its Markdown. The development server has no
// assets and renders instead. The docs' own files (config.ts `files`) are plain assets. A /docs URL
// without a page here goes to the V1 docs (route.ts).

const pageHeaders = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  Vary: "Accept",
}
const markdownType = "text/markdown; charset=utf-8"

export const docsMiddleware = createMiddleware({
  async onRequest(event) {
    const url = new URL(event.request.url)
    const route = docsRoute(url, event.request.headers.get("accept") ?? "", docsSlugs)
    if (!route) return
    setSecurityHeaders(event.response.headers)
    if (route.type === "redirect")
      return new Response(null, { status: route.status, headers: { Location: route.location } })
    if (route.type === "missing") return notFound()
    if (route.type === "file") {
      // Static assets in the Worker, so only the development server reaches these two.
      if (route.path === "/llms.txt")
        return new Response(renderLlmsTxt(new URL(config.baseUrl)), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      if (route.path === "/sitemap.xml")
        return new Response(renderSitemap(new URL(config.baseUrl)), {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        })
      // A file that isn't there, such as an old build's stylesheet.
      return notFound()
    }

    const response = await asset(route.set, route.slug, route.markdown, url, event.request)
    if (!response.ok && response.status !== 304) return notFound()
    // Without a twin there is nothing to negotiate, so the API reference is served as the plain file.
    if (!route.twin) return response
    const headers = new Headers(response.headers)
    Object.entries(pageHeaders).forEach(([name, value]) => headers.set(name, value))
    if (route.markdown) headers.set("Content-Type", markdownType)
    return new Response(event.request.method === "HEAD" ? null : response.body, { status: response.status, headers })
  },
})

/** A prerendered docs file from the Worker's assets, or rendered on request by the development server. */
async function asset(set: DocsSet, slug: string, markdown: boolean, url: URL, request: Request) {
  const href = markdown ? docsMarkdownHref(slug, set) : docsHref(slug, set)
  const binding = assets()
  // Assets drop the trailing slash (cloudflare.config.ts htmlHandling) and find the page's index.html.
  if (binding) return binding.fetch(new Request(new URL(href.replace(/(.)\/$/, "$1"), url), request))
  if (!import.meta.env.DEV) return notFound()
  const { renderDocsMarkdown, renderDocsPage } = await import("./render")
  const body = markdown
    ? await renderDocsMarkdown(set, slug)
    : await renderDocsPage(set, slug, { stylesheet: "/src/docs/styles/docs.css", script: "/src/docs/client.ts" })
  if (body === undefined) return notFound()
  return new Response(body, {
    headers: { "Content-Type": markdown ? markdownType : "text/html; charset=utf-8" },
  })
}

// h3 doesn't add the prepared headers to an error response, so this one carries them itself.
function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", ...securityHeaders } })
}
