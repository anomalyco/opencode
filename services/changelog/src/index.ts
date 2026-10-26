import { anchor, parseChangelog, renderEntry } from "./markdown"
import { renderPage, type PageState } from "./page"

const SOURCE_URL = "https://raw.githubusercontent.com/anomalyco/opencode/dev/CHANGELOG.md"

// Fresh for five minutes, then served stale for up to a day while requests revalidate it in the background. A failed
// revalidation keeps serving the stale copy, so a GitHub outage only shows an error once the day-old copy is evicted.
const CACHE_KEY = "https://opencode.ai/changelog/source.md"
const FRESH_SECONDS = 300
const STALE_SECONDS = 86400
const FETCHED_AT = "x-opencode-changelog-fetched-at"

const PAGE_CACHE = `public, max-age=60, s-maxage=${FRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`
const SECURITY = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
}

type Context = Pick<ExecutionContext, "waitUntil">

async function refresh(cache: Cache | undefined) {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "opencode-changelog" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)
  if (!response?.ok) return
  const markdown = await response.text()
  await cache?.put(
    CACHE_KEY,
    new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": `public, s-maxage=${FRESH_SECONDS + STALE_SECONDS}`,
        [FETCHED_AT]: String(Date.now()),
      },
    }),
  )
  return markdown
}

/** Reads CHANGELOG.md through the colo's Workers cache; resolves undefined when no copy is available at all. */
export async function loadSource(ctx: Context, cache: Cache | undefined = defaultCache()) {
  const cached = await cache?.match(CACHE_KEY)
  if (!cached) return refresh(cache)
  if (Date.now() - Number(cached.headers.get(FETCHED_AT)) > FRESH_SECONDS * 1000) ctx.waitUntil(refresh(cache))
  return cached.text()
}

function defaultCache() {
  if (typeof caches === "undefined" || !("default" in caches)) return
  return (caches as CacheStorage & { default: Cache }).default
}

function html(state: PageState, status: number, cacheControl: string, method: string) {
  return new Response(method === "HEAD" ? null : renderPage(state), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheControl, ...SECURITY },
  })
}

function redirect(url: URL, location: string, status: number) {
  return Response.redirect(new URL(location, url).toString(), status)
}

export async function handle(request: Request, load: () => Promise<string | undefined>) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } })

  const url = new URL(request.url)
  const path = url.pathname
  if (path === "/changelog/") return redirect(url, "/changelog", 308)
  const version = /^\/changelog\/(v\d[\w.-]*)$/.exec(path)
  if (version) return redirect(url, `/changelog#${anchor(version[1])}`, 302)
  if (path.startsWith("/changelog/")) return html({ type: "not-found" }, 404, "public, max-age=300", request.method)
  if (path !== "/changelog") return redirect(url, "/changelog", 302)

  const markdown = await load().catch(() => undefined)
  if (markdown === undefined) return html({ type: "error" }, 503, "no-store", request.method)
  return html({ type: "ok", entries: parseChangelog(markdown).map(renderEntry) }, 200, PAGE_CACHE, request.method)
}

export default {
  fetch(request, _env, ctx) {
    return handle(request, () => loadSource(ctx))
  },
} satisfies ExportedHandler
