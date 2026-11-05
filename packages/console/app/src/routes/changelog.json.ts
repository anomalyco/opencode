import { feedWait, loadChangelog, type ChangelogData } from "~/lib/changelog"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const ok = "public, max-age=1, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
const error = "public, max-age=1, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400"

export async function GET() {
  const result = await loadChangelog(feedWait).catch((): ChangelogData => ({ ok: false, releases: [] }))

  // The latest 20, as before: the apps' "What's new" and site search read this; older releases
  // are on the changelog pages, and one release is at /changelog/<tag>.json.
  return new Response(JSON.stringify({ releases: result.releases.slice(0, 20) }), {
    status: result.ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      // Stale releases are cached as briefly as an error, so fresh ones replace them soon.
      "Cache-Control": result.ok && !result.stale ? ok : error,
      ...cors,
    },
  })
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: cors,
  })
}
