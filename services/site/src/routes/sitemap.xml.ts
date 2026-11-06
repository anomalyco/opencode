import type { APIEvent } from "@solidjs/start/server"
import { sitemapFiles, sitemapIndexXml } from "~/lib/sitemap"

/** The one public sitemap, an index of this app's pages sitemap and the other apps' sitemaps. */
export function GET(_event: APIEvent) {
  return new Response(sitemapIndexXml(sitemapFiles), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}
