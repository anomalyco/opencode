import { query } from "@solidjs/router"
import { staleValue } from "~/lib/edge-cache"

export type ServiceStatus = "operational" | "degraded" | "outage" | "unknown"

const rank: Record<ServiceStatus, number> = { unknown: 0, operational: 1, degraded: 2, outage: 3 }

// The public status page API. It sends no CORS headers, so this runs on the server. Every page's
// footer shows it, so it is reused for a minute and refreshed in the background (lib/edge-cache.ts):
// a render waits at most 300 ms, else the footer shows its usual placeholder bars.
const bars = staleValue<ServiceStatus[]>({
  key: "status/bars",
  freshFor: 60_000,
  wait: 300,
  load: async () => {
    const response = await fetch("https://status.opencode.ai/api/status", {
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined)
    if (!response?.ok) return
    const data = (await response.json()) as {
      status: ServiceStatus
      history: { start: number; services: Record<string, ServiceStatus> }[]
    }
    // The first five bars are the latest 3-hour history windows, colored by their worst service;
    // the last bar is the live overall status. The footer shows the most recent 3 to 6.
    return [...data.history.slice(-5).map((entry) => worst(Object.values(entry.services))), data.status]
  },
  fallback: () => undefined,
  marksStandIn: false,
})

export const status = query(async () => {
  "use server"
  return (await bars()).value
}, "status")

function worst(statuses: ServiceStatus[]) {
  return statuses.reduce<ServiceStatus>((result, item) => (rank[item] > rank[result] ? item : result), "unknown")
}
