import type { APIEvent } from "@solidjs/start/server"
import fileRoutes from "solid-start:routes"
import type { ChangelogData } from "~/lib/changelog"
import { feedWait, loadChangelog } from "~/lib/changelog-releases"
import { sitemapPages, sitemapXml } from "~/lib/sitemap"

const ok = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400"
// Without the changelog the release pages are missing, so it is cached only briefly.
const partial = "public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=86400"

/** This app's pages sitemap, built per request from the app's page routes and the changelog. See ~/lib/sitemap. */
export async function GET(_event: APIEvent) {
  const changelog = await loadChangelog(feedWait).catch((): ChangelogData => ({ ok: false, releases: [] }))
  const routes = fileRoutes.filter((route) => route.page).map((route) => route.path)
  return new Response(sitemapXml(sitemapPages(routes, { releases: changelog.releases })), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": changelog.ok && !changelog.stale ? ok : partial,
    },
  })
}
