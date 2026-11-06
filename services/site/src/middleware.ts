import { createMiddleware } from "@solidjs/start/middleware"
// Every language, before any route (pages, API and Markdown) translates.
import "~/i18n/server"
import { sanitizeServerActionRequest } from "~/lib/server-action"
import {
  LOCALE_HEADER,
  cookie,
  fromPathname,
  localeFromCookieHeader,
  localeFromRequest,
  route,
  strip,
} from "~/lib/language"
import { absoluteUrl, markdownHeaders } from "~/lib/markdown"
import { changelogEntryJson } from "~/lib/changelog-releases"
import { findPageMarkdown, renderPageMarkdown } from "~/lib/page-markdown"
import { htmlCache } from "~/lib/html-cache"
import { oneStylesheet } from "~/lib/one-stylesheet"
import securityTxt from "~/lib/legal/security.txt?raw"
import humansTxt from "~/lib/humans.txt?raw"
import { robotsTxt } from "~/lib/robots-txt"
import { mediaUrl } from "~/lib/media"
import { legacyRedirect } from "~/lib/legacy"
import { metaResponse } from "~/lib/meta"
import { securityHeaders } from "~/lib/security-headers"
import { v1DocsOrigin } from "~/lib/docs"

// The page middleware, then the HTML cache headers and edge cache (lib/html-cache.ts), which see
// the request without its locale, then one stylesheet per page (lib/one-stylesheet.ts), inside the
// cache so cached pages carry it too.
export default [
  ...createMiddleware({
    async onRequest(event) {
      // The OAuth client document and the Apple app association, before anything else (lib/meta.ts).
      const meta = metaResponse(event.request)
      if (meta) return meta
      // Every other response, pages and redirects included (lib/security-headers.ts).
      Object.entries(securityHeaders).forEach(([name, value]) => event.response.headers.set(name, value))

      event.request = sanitizeServerActionRequest(event.request)

      const url = new URL(event.request.url)
      // The brand zip lived at the site root; it is in the files bucket now (src/lib/media.ts).
      if (url.pathname === "/opencode-brand-assets.zip")
        return new Response(null, { status: 301, headers: { Location: mediaUrl(url.pathname) } })
      const requested = url.pathname
      const locale = fromPathname(url.pathname)
      if (locale) {
        url.pathname = strip(url.pathname)
        const request = new Request(url, event.request)
        request.headers.set(LOCALE_HEADER, locale)
        event.request = request
        // Only when it changes: a response that sets a cookie can't be shared by caches.
        if (localeFromCookieHeader(request.headers.get("cookie")) !== locale)
          event.response.headers.append("set-cookie", cookie(locale))
      }

      // Old URLs kept alive for outside links and older apps (lib/legacy.ts), all to be removed.
      const legacy = legacyRedirect({
        path: url.pathname,
        search: url.search,
        method: event.request.method,
        locale,
      })
      if (legacy) return legacy

      // The V1 docs live at /v1/docs on our domain (English only, so the locale is dropped). Their
      // app is built for docs.opencode.ai/docs/ (absolute links and assets), so it can't be proxied
      // under another path: the same path there, permanently, until it's built for /v1/docs.
      if (/^\/v1\/docs(?=$|\/)/.test(url.pathname))
        return new Response(null, {
          status: 308,
          headers: { Location: `${v1DocsOrigin}${url.pathname.slice("/v1/docs/".length)}${url.search}` },
        })

      // The download page's content moved to /product and the product pages, and /products became
      // /product. The legacy redirects (/go, /zen, /enterprise, /black, /auth, …) are zone rules.
      const moved = movedPath(url.pathname)
      if (moved) {
        return new Response(null, {
          status: 301,
          headers: { Location: `${locale ? route(locale, moved) : moved}${url.search}` },
        })
      }

      if (event.request.method !== "GET" && event.request.method !== "HEAD") return
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname
      // One address per page: English pages have no /en prefix, the English-only changelog and font
      // have no locale prefix, and pages have no trailing slash, so those addresses redirect rather
      // than serve a duplicate. /data picks its own locale and keeps /en; the docs have their own
      // slash rules.
      const english = locale === "en" && !/^\/data(\/|$)/.test(path)
      const englishOnly = locale !== null && /^\/(changelog|font)(?=$|[/.])/.test(path)
      const slash = requested.length > 1 && requested.endsWith("/") && !/^\/docs(\/|$)/.test(path)
      if (english || englishOnly || (slash && findPageMarkdown(path))) {
        return new Response(null, { status: 301, headers: { Location: `${route(locale ?? "en", path)}${url.search}` } })
      }
      // One release as JSON, at a stable URL per version (for the apps' "What's new").
      const release = path.match(/^\/changelog\/(v\d[\w.+-]*)\.json$/)?.[1]
      if (release) return changelogEntryJson(release)
      // RFC 9116. Served here because the file router skips dot-folders such as /.well-known.
      if (path === "/.well-known/security.txt")
        return new Response(event.request.method === "HEAD" ? null : securityTxt, {
          headers: textHeaders,
        })
      // Generated by src/lib/robots-txt.ts. Served here, not from public/, so it gets a charset: its
      // comments use block characters.
      if (path === "/robots.txt")
        return new Response(event.request.method === "HEAD" ? null : await robotsTxt(), {
          headers: textHeaders,
        })
      // The people behind OpenCode (https://humanstxt.org). Served here because public/ files get no
      // charset, and without one browsers garble its block characters.
      if (path === "/humans.txt")
        return new Response(event.request.method === "HEAD" ? null : humansTxt, {
          headers: textHeaders,
        })
      // Pages with a Markdown version serve it at their `.md` URL, and at their own URL to clients
      // that prefer text/markdown over text/html.
      const file = path.endsWith(".md") ? (path === "/index.md" ? "/" : path.slice(0, -3)) : undefined
      const page = file ?? path
      const found = findPageMarkdown(page)
      if (!found) return
      // Without a locale in the path, the language comes from the cookie or Accept-Language.
      const vary = [...(file ? [] : ["Accept"]), ...(locale ? [] : ["Accept-Language", "Cookie"])].join(", ")
      if (!file) event.response.headers.append("Vary", vary)
      if (!file && !prefersMarkdown(event.request.headers.get("accept"))) return

      const language = localeFromRequest(event.request)
      const body = await renderPageMarkdown(page, language, url.searchParams)
      if (body === undefined) return
      return new Response(event.request.method === "HEAD" ? null : body, {
        headers: {
          ...markdownHeaders,
          ...(vary ? { Vary: vary } : {}),
          Link: `<${absoluteUrl(route(found.englishOnly ? "en" : language, page))}>; rel="canonical"`,
          ...(found.draft ? { "X-Robots-Tag": "noindex" } : {}),
        },
      })
    },
  }),
  htmlCache,
  oneStylesheet,
]

// The text files above change with releases and carry dates, so they are cached for an hour.
const textHeaders = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
}

/** Where an old URL (without its locale) lives now, or undefined when it has not moved. */
function movedPath(pathname: string) {
  // The download page is gone; its desktop files stay at /download/<channel>/<platform>.
  if (pathname === "/download" || pathname === "/download/") return "/product"
  if (pathname === "/download.md") return "/product.md"
  if (/^\/products(?=$|[/.])/.test(pathname)) return `/product${pathname.slice("/products".length)}`
}

/** True when the Accept header ranks text/markdown above text/html. Ties go to HTML. */
function prefersMarkdown(accept: string | null) {
  if (!accept) return false
  const ranges = accept.split(",").map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";")
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="))
    return { type: type.trim(), q: q ? Number(q.slice(2)) : 1 }
  })
  // The most specific matching range sets a type's quality.
  const quality = (type: string) =>
    ranges.find((range) => range.type === type)?.q ??
    ranges.find((range) => range.type === `${type.split("/")[0]}/*`)?.q ??
    ranges.find((range) => range.type === "*/*")?.q ??
    0
  return quality("text/markdown") > quality("text/html")
}
