import { createMiddleware } from "@solidjs/start/middleware"
import { assets } from "#resource"
import { config } from "~/config"
import { cookie, localeFromCookieHeader, type Locale } from "~/lib/language"
import { securityHeaders, setSecurityHeaders } from "~/lib/security-headers"
import type { DocsSet } from "./config"
import { docsSlugs } from "virtual:docs-pages"
import { renderLlmsTxt } from "./lib/llms"
import { docsLocaleHref, docsLocaleMarkdownHref } from "./lib/navigation"
import { docsHostRedirect, docsRoute } from "./route"

// Everything under /docs, the latest docs' languages under /<locale>/docs, and /v1/docs (config.ts
// `docsSets`). Docs pages and their Markdown twins are static assets prerendered at build
// (script/build.ts). Docs URLs come here first (cloudflare.config.ts runWorkerFirst), so one URL can
// answer with the page or, to `Accept: text/markdown`, its Markdown. The development server has no
// assets and renders instead. The docs' own files (config.ts `files`) are plain assets. A /docs URL
// without a page here goes to the V1 docs (route.ts), and the V1 docs' old host, docs.opencode.ai,
// to the same path here.

const pageHeaders = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  Vary: "Accept",
}
const markdownType = "text/markdown; charset=utf-8"

export const docsMiddleware = createMiddleware({
  async onRequest(event) {
    const url = new URL(event.request.url)
    const host = docsHostRedirect(url)
    if (host) return new Response(null, { status: 301, headers: { Location: host } })
    const route = docsRoute(url, event.request.headers.get("accept") ?? "", docsSlugs)
    if (!route) return
    setSecurityHeaders(event.response.headers)
    if (route.type === "redirect")
      return new Response(null, { status: route.status, headers: { Location: route.location } })
    if (route.type === "missing") return notFound()
    if (route.type === "file") {
      // Static assets in the Worker, so only the development server reaches these two, for the latest docs.
      if (route.path === "/llms.txt" && route.set.id === "latest")
        return new Response(renderLlmsTxt(new URL(config.baseUrl)), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
      if (route.path === "/sitemap.xml") {
        // The built sitemap is an asset; only the development server renders it, so the renderer
        // (and every page's MDX) stays out of the Worker.
        if (!import.meta.env.DEV) return notFound()
        const { renderDocsSitemap } = await import("./render")
        return new Response(await renderDocsSitemap(new URL(config.baseUrl)), {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        })
      }
      // A file that isn't there, such as an old build's stylesheet.
      return notFound()
    }

    const response = await asset(route.set, route.slug, route.markdown, route.locale, url, event.request)
    if (!response.ok && response.status !== 304) return notFound()
    // The language picker's links set the cookie on their response, as the site's do, so the
    // visitor's next unprefixed page keeps the choice.
    if (
      route.set.id === "latest" &&
      route.locale !== "en" &&
      localeFromCookieHeader(event.request.headers.get("cookie")) !== route.locale
    )
      event.response.headers.append("set-cookie", cookie(route.locale))
    // Without a twin there is nothing to negotiate, so the API reference is served as the plain file.
    if (!route.twin) return response
    const headers = new Headers(response.headers)
    Object.entries(pageHeaders).forEach(([name, value]) => headers.set(name, value))
    if (route.markdown) headers.set("Content-Type", markdownType)
    // The pages say so too (DocsLayout.tsx); their Markdown twins can only say it here.
    if (route.set.noindex) headers.set("X-Robots-Tag", "noindex")
    return new Response(event.request.method === "HEAD" ? null : response.body, { status: response.status, headers })
  },
})

/** A prerendered docs file from the Worker's assets, or rendered on request by the development server. */
async function asset(set: DocsSet, slug: string, markdown: boolean, locale: Locale, url: URL, request: Request) {
  const href = markdown ? docsLocaleMarkdownHref(slug, set, locale) : docsLocaleHref(slug, set, locale)
  const binding = assets()
  // Assets drop the trailing slash (cloudflare.config.ts htmlHandling) and find the page's index.html.
  if (binding) return binding.fetch(new Request(new URL(href.replace(/(.)\/$/, "$1"), url), request))
  if (!import.meta.env.DEV) return notFound()
  const { renderDocsMarkdown, renderDocsPage } = await import("./render")
  const body = markdown
    ? await renderDocsMarkdown(set, slug, locale)
    : await renderDocsPage(
        set,
        slug,
        { stylesheet: "/src/docs/styles/docs.css", script: "/src/docs/client.ts" },
        locale,
      )
  if (body === undefined) return notFound()
  return new Response(body, {
    headers: { "Content-Type": markdown ? markdownType : "text/html; charset=utf-8" },
  })
}

// h3 doesn't add the prepared headers to an error response, so this one carries them itself.
function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", ...securityHeaders } })
}
