import type { ChangelogData } from "~/lib/changelog"
import { feedWait, loadChangelog } from "~/lib/changelog-releases"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const ok = "public, max-age=1, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
const empty = "public, max-age=1, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400"

// A contract: the desktop app's "What's new" and the site search read this URL. It never answers
// 503. When GitHub fails, the build-time snapshot answers (lib/changelog.ts), and only with neither
// is the list empty, cached briefly so the next answer replaces it soon.
export async function GET() {
  const result = await loadChangelog(feedWait).catch((): ChangelogData => ({ ok: false, releases: [] }))

  // The latest 20, as before; older releases are on the changelog pages, and one release is at
  // /changelog/<tag>.json.
  return new Response(JSON.stringify({ releases: result.releases.slice(0, 20) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": result.ok ? ok : empty,
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
