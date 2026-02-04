import { loadChangelog } from "~/lib/changelog"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const ok = "public, max-age=1, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
const error = "public, max-age=1, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400"

export async function GET() {
  const result = await loadChangelog().catch(() => ({ ok: false, releases: [] }))

  return new Response(JSON.stringify({ releases: result.releases }), {
    status: result.ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": result.ok ? ok : error,
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
