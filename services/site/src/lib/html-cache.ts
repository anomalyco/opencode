import type { createMiddleware } from "@solidjs/start/middleware"
import { getRequestEvent } from "solid-js/web"
import { background, edgeCache } from "~/lib/edge-cache"
import { LOCALE_HEADER, localeFromRequest } from "~/lib/language"
import { findPageMarkdown } from "~/lib/page-markdown"
import { platformFromUserAgent } from "~/lib/platform"

// Cache headers for every page and, for the public pages, Cloudflare's cache at the Worker's
// location (the Workers Cache API), so a visit is answered without rendering.
//
// - Public pages (every page with a Markdown version, in every language): browsers revalidate each
//   time (`public, max-age=0, must-revalidate`, with an ETag, so an unchanged page is a 304). The
//   Worker keeps each page for 5 minutes, then serves it stale for up to a day while it renders a
//   fresh copy in the background (ctx.waitUntil).
// - Personal, sign-in and API addresses: `private, no-store`.
//
// The cache key is the page's address without its locale, plus the language the page renders in
// and the visitor's platform class, because the server renders both: an unprefixed address follows
// the oc_locale cookie, else Accept-Language (decision D7, still open, keeps negotiating), and the
// download buttons and product order follow the user agent. So one cached copy serves everyone who
// would get the same HTML, and Vary (which Cloudflare's cache would apply to raw header values) plays
// no part. The build id is in the key too, so a deploy starts from an empty cache without a purge.
//
// Never cached: a response that sets other cookies, and any status but 200; a server error (a
// release page while GitHub is down) also tells browsers not to keep it, and to retry in a minute. A render that used a stand-in for GitHub's data (lib/edge-cache.ts)
// is kept fresh for 30 seconds only.

type Middleware = ReturnType<typeof createMiddleware>[number]

const freshFor = 5 * 60_000
const staleFor = 24 * 60 * 60_000
const standInFor = 30_000
const cachedAt = "X-HTML-Cached-At"
const browserPolicy = "public, max-age=0, must-revalidate"
// A response that sets a cookie is for one visitor; it still revalidates every time.
const cookiePolicy = "private, max-age=0, must-revalidate"
const personal = /^\/(workspace|auth|api|console|user-menu|stripe|desktop-feedback|_server)(?=$|[/.])/
// Cookies the site's own middleware sets on public pages (the language and a referral code); the
// rendered page doesn't depend on them being set, so the cached copy simply leaves them out.
const ownCookies = /^(oc_locale|oc_referral)=/

const stamp = Object.values(
  import.meta.glob<{ default: { commit?: string; build?: string } }>("./build-stamp.json", { eager: true }),
)[0]?.default
const build = stamp?.build ?? stamp?.commit ?? "dev"
const refreshing = new Set<string>()

/** How a response may be cached: a public page, a personal response, or neither (left as it is). */
export function responseClass(path: string, method: string) {
  if (personal.test(path)) return "personal"
  if (method !== "GET" && method !== "HEAD") return "personal"
  const page = findPageMarkdown(path)
  if (page && !page.draft) return "page"
}

export const htmlCache: Middleware = async (event, next) => {
  const fetchEvent = getRequestEvent()
  if (!fetchEvent) return next()
  const request = fetchEvent.request
  const url = new URL(request.url)
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname
  const kind = responseClass(path, request.method)
  if (kind === "personal") {
    event.res.headers.set("Cache-Control", "private, no-store")
    return next()
  }
  if (kind !== "page") return next()

  const cache = edgeCache()
  // A prefixed address (/ja) and a negotiated one (/ in Japanese) are kept apart.
  const language = `${localeFromRequest(request)}${request.headers.has(LOCALE_HEADER) ? "" : "-negotiated"}`
  const platform = platformFromUserAgent(request.headers.get("user-agent") ?? "") ?? "other"
  const key = new Request(`${url.origin}/__html/${build}/${language}/${platform}${path}${url.search}`)
  const hit = cache && (await cache.match(key).catch(() => undefined))
  if (cache && hit) {
    const stale = Date.now() - Number(hit.headers.get(cachedAt)) > freshFor
    if (stale && !refreshing.has(key.url)) {
      refreshing.add(key.url)
      background(
        Promise.resolve(next())
          .then((value) => store(cache, key, value))
          .finally(() => refreshing.delete(key.url)),
      )
    }
    return serve(hit, request, event.res.headers, stale ? "STALE" : "HIT")
  }

  const value = await next()
  if (typeof value !== "string") return value
  if (event.res.status && event.res.status >= 500) {
    event.res.headers.set("Cache-Control", "no-store")
    event.res.headers.set("Retry-After", "60")
    return value
  }
  const cookies = event.res.headers.getSetCookie()
  event.res.headers.set("Cache-Control", cookies.length ? cookiePolicy : browserPolicy)
  event.res.headers.set("ETag", await etag(value))
  if (!cache) return value
  event.res.headers.set("X-HTML-Cache", "MISS")
  if (request.method === "GET") background(store(cache, key, value))
  return value
}

/** Stores a render for `staleFor` past its freshness, unless it can't be shared. */
async function store(cache: Cache, key: Request, value: unknown) {
  const event = getRequestEvent()
  const status = event?.response.status ?? 200
  if (!event || typeof value !== "string" || status !== 200) return
  const cookies = event.response.headers.getSetCookie()
  if (cookies.some((cookie) => !ownCookies.test(cookie))) return
  const headers = new Headers(event.response.headers)
  headers.delete("Set-Cookie")
  headers.delete("X-HTML-Cache")
  headers.set("ETag", await etag(value))
  headers.set("Cache-Control", `public, max-age=${(freshFor + staleFor) / 1000}`)
  // A render with a stand-in for GitHub's data is fresh for 30 seconds only, then served stale while
  // a new render tries again.
  headers.set(cachedAt, String(event.locals.standIn ? Date.now() - freshFor + standInFor : Date.now()))
  await cache.put(key, new Response(value, { status: 200, headers }))
}

/** A cached page for this visitor: a 304 when their copy is current, else the page. */
function serve(hit: Response, request: Request, pending: Headers, state: "HIT" | "STALE") {
  const headers = new Headers(hit.headers)
  headers.delete(cachedAt)
  headers.set("Cache-Control", pending.getSetCookie().length ? cookiePolicy : browserPolicy)
  headers.set("X-HTML-Cache", state)
  const current = request.headers.get("If-None-Match")
  if (current && current === headers.get("ETag") && !pending.getSetCookie().length)
    return new Response(null, { status: 304, headers })
  return new Response(request.method === "HEAD" ? null : hit.body, { status: 200, headers })
}

async function etag(body: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body))
  const hex = Array.from(new Uint8Array(digest).slice(0, 10), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `W/"${hex}"`
}
