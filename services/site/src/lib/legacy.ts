import type { Locale } from "~/lib/language"
import { desktopAssets, updateApi } from "~/lib/download"

// LEGACY REDIRECTS, every one to be removed later. Old URLs that outside links, bookmarks, scripts
// and older app versions still request, answered here so they keep working. Nothing in this repo may
// link to any of them. Each says why it exists and who still uses it.
//
// `path` is the request path with its locale prefix already stripped (middleware.ts); `locale` is
// that prefix, or null.

type Legacy = { path: string; search: string; method: string; locale: Locale | null }

export function legacyRedirect(request: Legacy): Response | undefined {
  const read = request.method === "GET" || request.method === "HEAD"

  // Desktop downloads. External bookmarks, other sites and curl/wget scripts, about 45k requests a
  // week (Oct 2026); the site links the update API directly (lib/download.ts). A static redirect
  // with no fetch: the update API answers with a 302 to the file in the files bucket. HEAD gets the
  // redirect here too, because the update API answers HEAD with a 405. `stable` is the old `latest`.
  const download = request.path.match(/^\/download\/([^/]+)\/([^/]+)$/)
  if (download && read) {
    const platform = download[2]
    if (!Object.hasOwn(desktopAssets, platform)) return new Response(null, { status: 404 })
    const channel = download[1] === "stable" ? "latest" : download[1]
    return redirect(
      302,
      `${updateApi}/${channel}/desktop/opencode/${desktopAssets[platform as keyof typeof desktopAssets]}`,
    )
  }

  // The Go, Zen, pricing, models, teams and enterprise pages moved to the Console. V1 and V2 app
  // links (`/go` about 75k requests a day, `/zen` 46k). Exact paths only: /zen/v1/* and /zen/go/v1/*
  // are the inference API, which a prefix match here would break.
  const moved = (request.locale ? localizedMoves : moves).get(request.path.replace(/(.)\/$/, "$1"))
  if (moved && read) return redirect(302, `${moved}${request.search}`, "no-store")

  // The legacy dashboard and its sign-in, now the Console. The V1 CLI's "create a key at /auth" and
  // V1's usage-limit link /workspace/<id>/go (about 50k requests a day).
  if (/^\/(auth|workspace)(\/|$)/.test(request.path))
    return redirect(302, "https://opencode.ai/console/login", "no-store")

  // OpenCode Black was discontinued; its subscriptions moved to Go. Old links, about 100 a day.
  if (/^\/black(\/|$)/.test(request.path)) return redirect(301, "/console/go")

  // The stats site's old name: it lives at /data (the Stats Worker). Old links, about 130 a day.
  if (/^\/stats(\/|$)/.test(request.path))
    return redirect(308, `/data${request.path.slice("/stats".length)}${request.search}`)

  // V1 share links. Sharing is discontinued: opncd.ai/share/<id> explains that (410). Hundreds a day.
  const share = request.path.match(/^\/s\/([^/]+)\/?$/)
  if (share) return redirect(301, `https://opncd.ai/share/${share[1]}`)

  // The V2 docs' first address, before they moved to /docs in Nov 2026. Apps up to v2.2.5 (Help menu,
  // settings links, the opencode skill), the READMEs and install script of those releases, search
  // engines and outside links. Pages, Markdown twins and the docs' files (llms.txt, the sitemap,
  // openapi.json) keep their path under /docs. The install script and the V2 config schema
  // (/v2/install, /v2/cli.json) are not docs and stay at /v2.
  const v2 = v2DocsPath(request.path)
  if (v2 && read) return redirect(301, `${v2}${request.search}`)
}

/** Where a /v2 docs URL lives under /docs, or undefined for any other path. */
function v2DocsPath(path: string) {
  const match = path.match(/^\/v2(\/.*)?$/)
  if (!match || path === "/v2/install" || path === "/v2/cli.json") return
  const rest = match[1] ?? "/"
  // The intro's Markdown twin.
  if (rest === "/docs.md") return "/docs/index.md"
  return `/docs${rest.replace(/^\/docs(?=$|\/)/, "") || "/"}`
}

const moves = new Map([
  ["/go", "/console/go"],
  ["/zen", "/console/models"],
  ["/zen/go", "/console/go"],
  ["/pricing", "/console/go"],
  ["/models", "/console/models"],
  ["/teams", "/console/teams"],
  ["/enterprise", "/console/enterprise"],
])

// The old site rendered these three pages in every language; their localized URLs follow them.
const localizedMoves = new Map([
  ["/go", "/console/go"],
  ["/zen", "/console/models"],
  ["/enterprise", "/console/enterprise"],
])

function redirect(status: number, location: string, cache?: string) {
  return new Response(null, {
    status,
    headers: { Location: location, ...(cache ? { "Cache-Control": cache } : {}) },
  })
}
