import type { APIEvent } from "@solidjs/start/server"
import { getRequestEvent } from "solid-js/web"
import { edgeCache } from "~/lib/edge-cache"

// A page's stylesheets as one file (lib/one-stylesheet.ts): /stylesheet/<name>~<name>….css joins
// /_build/assets/<name>.css in the order given. The names carry content hashes, so the result never
// changes and is cached for a year, by browsers and at the edge.
const name = /^[\w-]+$/

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const file = url.pathname.slice("/stylesheet/".length)
  if (!file.endsWith(".css")) return new Response("Not found", { status: 404 })
  const names: string[] = file.slice(0, -4).split("~")
  if (!names.length || names.length > 40 || !names.every((part) => name.test(part)))
    return new Response("Not found", { status: 404 })

  const cache = edgeCache()
  const key = new Request(`${url.origin}/stylesheet/${file}`)
  const hit = cache && (await cache.match(key).catch(() => undefined))
  if (hit) return hit

  const assets = (
    getRequestEvent()?.nativeEvent.context as { cloudflare?: { env?: { ASSETS?: { fetch: typeof fetch } } } }
  ).cloudflare?.env?.ASSETS
  const parts = await Promise.all(
    names.map(async (part) => {
      const request = new Request(`${url.origin}/_build/assets/${part}.css`)
      const response = await (assets ? assets.fetch(request) : fetch(request))
      return response.ok ? response.text() : undefined
    }),
  )
  if (parts.some((part) => part === undefined)) return new Response("Not found", { status: 404 })
  const response = new Response(parts.join("\n"), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
  if (cache) await cache.put(key, response.clone()).catch(() => {})
  return response
}
