import { bannerPng, edgeCache, renderOgCard, waitUntil } from "#resource"
import { baseUrl } from "../lib/language"
import { statsPageCacheControl } from "../routes/stats-cache"
import type { OgCard } from "./card"
import { ogVersion } from "./card-data"

// The current ?v= (see ogImageUrl) names one rendering, so it can stay cached for days. Any other ?v=, or none, gets
// the pages' short cache.
const versionedCacheControl = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
// Unfurlers always get a PNG; the generic banner stands in briefly when a card can't render.
const fallbackCacheControl = "public, max-age=60, s-maxage=60"

// The /og.png response for a lab or model page. `path` is the page's path; `card` loads its card, or undefined when
// the page doesn't exist.
export async function ogResponse(input: {
  path: string
  version: string | null
  head: boolean
  card: () => Promise<OgCard | undefined>
}) {
  const cache = edgeCache()
  const requested = input.version !== null && /^[\w.-]{1,32}$/.test(input.version) ? input.version : undefined
  const cached = requested && (await cache?.match(cacheKey(input.path, requested)))
  if (cached) return reply(cached, input.head)
  const card = await input.card().catch(failed(input.path))
  if (!card) return fallback(input.head)
  // Only the card's current version is rendered and cached, so varying ?v= can't force new renders. A stale or made-up
  // one gets today's card.
  const version = ogVersion(card)
  const current = requested === version
  const key = cacheKey(input.path, version)
  const existing = current ? undefined : await cache?.match(key)
  if (existing) return reply(withCacheControl(existing, statsPageCacheControl), input.head)
  const png = await renderOgCard(card).catch(failed(input.path))
  if (!png) return fallback(input.head)
  const response = new Response(png, { headers: pngHeaders(versionedCacheControl) })
  if (cache) waitUntil(cache.put(key, response.clone()))
  return reply(current ? response : withCacheControl(response, statsPageCacheControl), input.head)
}

function cacheKey(path: string, version: string) {
  return new Request(`${baseUrl}${path}/og.png?v=${version}`)
}

function failed(path: string) {
  return (error: unknown) => {
    console.error("The OG card failed to render", path, error)
    return undefined
  }
}

async function fallback(head: boolean) {
  return reply(new Response(await bannerPng(), { headers: pngHeaders(fallbackCacheControl) }), head)
}

function pngHeaders(cacheControl: string) {
  return { "Content-Type": "image/png", "Cache-Control": cacheControl }
}

function withCacheControl(response: Response, cacheControl: string) {
  const copy = new Response(response.body, response)
  copy.headers.set("Cache-Control", cacheControl)
  return copy
}

function reply(response: Response, head: boolean) {
  return head ? new Response(null, response) : response
}
