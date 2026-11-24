import { bannerPng, edgeCache, renderOgCard, waitUntil } from "#resource"
import { statsPageCacheControl } from "../routes/stats-cache"
import type { OgCard } from "./card"
import { ogVersion } from "./card-data"

// The current ?v= (see ogImageUrl) names one rendering, so it can stay cached for days. Any other ?v=, or none, gets
// the pages' short cache.
const versionedCacheControl = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
// Unfurlers always get a PNG; the generic banner stands in briefly when a card can't render.
const fallbackCacheControl = "public, max-age=60, s-maxage=60"

// The /og.png response for a lab or model page. `origin` is the request's, so each stage keeps its own entries in the
// zone's cache; `path` is the image's path without a locale; `card` loads the page's card, or undefined when the page
// doesn't exist.
export async function ogResponse(input: {
  origin: string
  path: string
  version: string | null
  head: boolean
  card: () => Promise<OgCard | undefined>
}) {
  const cache = edgeCache()
  const cacheKey = (version: string) => new Request(`${input.origin}${input.path}?v=${version}`)
  const requested = input.version !== null && /^[\w.-]{1,32}$/.test(input.version) ? input.version : undefined
  const cached = requested && (await cache?.match(cacheKey(requested)))
  if (cached) return reply(cached, input.head)
  const card = await input.card().catch(failed(input.path))
  if (!card) return reply(await fallback(), input.head)
  // Only the card's current version is rendered and cached, so varying ?v= can't force new renders. A stale or made-up
  // one gets today's card.
  const version = ogVersion(card)
  const current = requested === version
  const key = cacheKey(version)
  const existing = current ? undefined : await cache?.match(key)
  if (existing) return reply(shortCache(existing), input.head)
  const png = await renderOgCard(card).catch(failed(input.path))
  // A failing renderer keeps serving the banner for its 60 seconds instead of being retried by every crawler.
  const response = png ? new Response(png, { headers: pngHeaders(versionedCacheControl) }) : await fallback()
  if (cache) waitUntil(cache.put(key, response.clone()))
  return reply(current ? response : shortCache(response), input.head)
}

function failed(path: string) {
  return (error: unknown) => {
    console.error("The OG card failed to render", path, error)
    return undefined
  }
}

async function fallback() {
  return new Response(await bannerPng(), { headers: pngHeaders(fallbackCacheControl) })
}

function pngHeaders(cacheControl: string) {
  return { "Content-Type": "image/png", "Cache-Control": cacheControl }
}

// A rendered card under another ?v= gets the pages' cache; the banner keeps its shorter one.
function shortCache(response: Response) {
  if (response.headers.get("Cache-Control") !== versionedCacheControl) return response
  const copy = new Response(response.body, response)
  copy.headers.set("Cache-Control", statsPageCacheControl)
  return copy
}

function reply(response: Response, head: boolean) {
  return head ? new Response(null, response) : response
}
