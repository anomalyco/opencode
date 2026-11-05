import { createMiddleware } from "@solidjs/start/middleware"
// Every language, before any route (pages, API and Markdown) translates.
import "~/i18n/server"
import { appleAppSiteAssociation } from "~/lib/apple-app-site-association"
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
import { changelogEntryJson } from "~/lib/changelog"
import { findPageMarkdown, renderPageMarkdown } from "~/lib/page-markdown"
import { htmlCache } from "~/lib/html-cache"
import { oneStylesheet } from "~/lib/one-stylesheet"
import securityTxt from "~/lib/legal/security.txt?raw"
import humansTxt from "~/lib/humans.txt?raw"
import { robotsTxt } from "~/lib/robots-txt"
import { mediaRedirect } from "~/lib/media"
import { v1DocsOrigin } from "~/lib/docs"

// The page middleware, then the HTML cache headers and edge cache (lib/html-cache.ts), which see
// the request without its locale, then one stylesheet per page (lib/one-stylesheet.ts), inside the
// cache so cached pages carry it too.
export default [
  ...createMiddleware({
    async onRequest(event) {
      const association = appleAppSiteAssociation(event.request)
      if (association) return association

      event.request = sanitizeServerActionRequest(event.request)

      const url = new URL(event.request.url)
      // Heavy media is in the opencode.ai files bucket, not in the static assets (src/lib/media.ts).
      const media = mediaRedirect(url.pathname, url.search)
      if (media) return media
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

      // The legacy dashboard and its sign-in moved to the new Console.
      if (/^\/(auth|workspace)(\/|$)/.test(url.pathname))
        return new Response(null, {
          status: 302,
          headers: { Location: "https://opencode.ai/console/login", "Cache-Control": "no-store" },
        })

      // The V1 docs live at /v1/docs on our domain (English only, so the locale is dropped). Their
      // app is built for docs.opencode.ai/docs/ (absolute links and assets), so it can't be proxied
      // under another path: the same path there, permanently, until it's built for /v1/docs.
      if (/^\/v1\/docs(?=$|\/)/.test(url.pathname))
        return new Response(null, {
          status: 308,
          headers: { Location: `${v1DocsOrigin}${url.pathname.slice("/v1/docs/".length)}${url.search}` },
        })

      // The Go, Zen, Enterprise, pricing, models and teams pages moved to the Console, Black is gone, the
      // download page's content moved to /product and the product pages, and /products became /product.
      const moved = movedPath(url.pathname)
      if (moved) {
        const headers = new Headers({
          Location: `${locale && !moved.startsWith("/console") ? route(locale, moved) : moved}${url.search}`,
        })
        event.response.headers.getSetCookie().forEach((value) => headers.append("set-cookie", value))
        return new Response(null, { status: 301, headers })
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
        const headers = new Headers({ Location: `${route(locale ?? "en", path)}${url.search}` })
        event.response.headers.getSetCookie().forEach((value) => headers.append("set-cookie", value))
        return new Response(null, { status: 301, headers })
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
  if (pathname === "/go" || pathname === "/go/") return "/console/go"
  // The download page is gone; its desktop files stay at /download/<channel>/<platform>.
  if (pathname === "/download" || pathname === "/download/") return "/product"
  if (pathname === "/download.md") return "/product.md"
  if (/^\/products(?=$|[/.])/.test(pathname)) return `/product${pathname.slice("/products".length)}`
  // Zen's page moved to the Console's Models page. /zen/v1/* and /zen/go/v1/* are the inference API
  // and stay where they are.
  if (/^\/zen\/(go\/)?v1(?=$|\/)/.test(pathname)) return
  if (/^\/zen\/go\/?$/.test(pathname)) return "/console/go"
  if (/^\/zen(?=$|\/)/.test(pathname)) return "/console/models"
  // OpenCode Black is discontinued; its subscriptions were migrated to Go.
  if (/^\/black(?=$|[/.])/.test(pathname)) return "/console/go"
  // The enterprise page moved to the Console.
  if (/^\/enterprise(?=$|[/.])/.test(pathname)) return "/console/enterprise"
  if (/^\/pricing\/?$/.test(pathname)) return "/console/go"
  if (/^\/models\/?$/.test(pathname)) return "/console/models"
  if (/^\/teams\/?$/.test(pathname)) return "/console/teams"
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
