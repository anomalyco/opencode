import { bars } from "~/lib/status"

// The footer's status bars (lib/status.ts) for pages that render without them: the V2 docs are
// static HTML, so their script asks here once the footer comes near (src/docs/client.ts). About
// 100 bytes, where the status page's own snapshot is about 90 kB.
export async function GET() {
  const value = (await bars()).value
  if (!value) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } })
  return Response.json(
    { bars: value },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  )
}
