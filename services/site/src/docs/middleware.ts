import { createMiddleware } from "@solidjs/start/middleware"
import { assets } from "#resource"
import { config } from "~/config"
import { base } from "./config"
import { docsSlugs } from "virtual:docs-pages"
import { renderLlmsTxt } from "./lib/llms"
import { docsHref, docsMarkdownHref } from "./lib/navigation"
import { renderSitemap } from "./lib/sitemap"

// Everything under /v2. Docs pages and their Markdown twins are static assets prerendered at build
// (script/build.ts). Docs URLs come here first (cloudflare.config.ts runWorkerFirst), so one URL can
// answer with the page or, to `Accept: text/markdown`, its Markdown. The development server has no
// assets and renders instead. Other /v2 files are plain assets; unknown /v2 URLs outside /v2/docs
// get the site's 404 page.

const pageHeaders = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  Vary: "Accept",
}
const markdownType = "text/markdown; charset=utf-8"

export const docsMiddleware = createMiddleware({
  async onRequest(event) {
    const url = new URL(event.request.url)
    if (!url.pathname.startsWith(base) && url.pathname !== base.slice(0, -1)) return
    const path = url.pathname.slice(base.length - 1)
    if (path === "" || path === "/") return redirect(`${base}docs/`, 301)
    if (path === "/install" || path === "/install/") return install()
    // Static assets in the Worker, so only the development server reaches these two.
    if (path === "/llms.txt")
      return new Response(renderLlmsTxt(new URL(config.baseUrl)), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    if (path === "/sitemap.xml")
      return new Response(renderSitemap(new URL(config.baseUrl)), {
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      })

    const file = path.endsWith(".md")
    const page = file ? path.slice(0, -3) : path
    if (!/^\/docs(\/|$)/.test(page) || page.startsWith("/docs/pagefind/")) return
    if (/^\/docs\/console\/inference\/?$/.test(page)) return redirect(`${base}docs/console/api/inference/`, 301)

    const slug = page.slice("/docs".length).replace(/^\/|\/$/g, "") || "index"
    if (!docsSlugs.includes(slug)) return notFound()
    const canonical = docsHref(slug)
    if (!file && path.endsWith("/") && !canonical.endsWith("/")) return redirect(canonical, 307)
    // The API reference has no Markdown twin.
    const twin = slug !== "api"
    const accept = event.request.headers.get("accept") ?? ""
    const markdown = file || (twin && (accept.includes("text/markdown") || accept.includes("text/x-markdown")))
    if (markdown && !twin) return notFound()

    const response = await asset(markdown ? docsMarkdownHref(slug) : canonical, url, event.request)
    if (!response.ok && response.status !== 304) return notFound()
    // Without a twin there is nothing to negotiate, so the API reference is served as the plain file.
    if (!twin) return response
    const headers = new Headers(response.headers)
    Object.entries(pageHeaders).forEach(([name, value]) => headers.set(name, value))
    if (markdown) headers.set("Content-Type", markdownType)
    return new Response(event.request.method === "HEAD" ? null : response.body, { status: response.status, headers })
  },
})

/** A prerendered docs file from the Worker's assets, or rendered on request by the development server. */
async function asset(href: string, url: URL, request: Request) {
  const binding = assets()
  // Assets drop the trailing slash (cloudflare.config.ts htmlHandling) and find the page's index.html.
  if (binding) return binding.fetch(new Request(new URL(href.replace(/(.)\/$/, "$1"), url), request))
  if (!import.meta.env.DEV) return notFound()
  const { renderDocsMarkdown, renderDocsPage } = await import("./render")
  const slug =
    href
      .slice(`${base}docs`.length)
      .replace(/\.md$/, "")
      .replace(/^\/|\/$/g, "") || "index"
  const body = href.endsWith(".md")
    ? await renderDocsMarkdown(slug)
    : await renderDocsPage(slug, { stylesheet: "/src/docs/styles/global.css", script: "/src/docs/client.ts" })
  if (body === undefined) return notFound()
  return new Response(body, {
    headers: { "Content-Type": href.endsWith(".md") ? markdownType : "text/html; charset=utf-8" },
  })
}

function redirect(location: string, status: number) {
  return new Response(null, { status, headers: { Location: location } })
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
}

async function install() {
  const response = await fetch("https://raw.githubusercontent.com/anomalyco/opencode/dev/install")
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
