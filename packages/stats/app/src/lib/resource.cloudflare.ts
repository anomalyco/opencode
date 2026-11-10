// The Stats Worker's bindings for the OG image route (src/og/response.ts). package.json `imports` picks this file for
// builds; resource.node.ts stands in under `vite dev` and tests.
import { env } from "cloudflare:workers"
import type { OgCard } from "../og/card"

export { waitUntil } from "cloudflare:workers"

type Fetcher = { fetch(request: Request): Promise<Response> }
const bindings = env as { OG_WORKER: Fetcher; ASSETS: Fetcher }

// The private StatsOg Worker renders cards (infra/stats.ts, src/og/worker.ts).
export async function renderOgCard(card: OgCard) {
  const response = await bindings.OG_WORKER.fetch(
    new Request("https://og/render", { method: "POST", body: JSON.stringify(card) }),
  )
  if (!response.ok) throw new Error(`The OG Worker answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

// The Worker's own static assets. A fetch to its public URL would not reach them: Cloudflare sends a Worker's
// subrequests to its own routes past it.
export async function bannerPng() {
  const response = await bindings.ASSETS.fetch(new Request("https://opencode.ai/data/banner.png"))
  if (!response.ok) throw new Error(`banner.png answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function edgeCache(): Cache | undefined {
  return (caches as unknown as { default: Cache }).default
}
