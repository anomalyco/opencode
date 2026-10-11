import type { TraceItem } from "@cloudflare/workers-types"

export default {
  async tail(events: TraceItem[]) {
    for (const event of events) {
      if (!event.event) continue
      if (!("request" in event.event)) continue
      if (event.event.request.method !== "POST") continue

      const url = new URL(event.event.request.url)
      if (
        url.pathname !== "/zen/v1/chat/completions" &&
        url.pathname !== "/zen/v1/messages" &&
        url.pathname !== "/zen/v1/responses" &&
        !url.pathname.startsWith("/zen/v1/models/") &&
        url.pathname !== "/zen/go/v1/chat/completions" &&
        url.pathname !== "/zen/go/v1/messages" &&
        url.pathname !== "/zen/go/v1/responses" &&
        !url.pathname.startsWith("/zen/go/v1/models/")
      )
        continue

      const ip = event.event.request.headers["x-real-ip"]
      let data: Record<string, unknown> = {
        "cf.continent": event.event.request.cf?.continent,
        "cf.country": event.event.request.cf?.country,
        "cf.city": event.event.request.cf?.city,
        "cf.region": event.event.request.cf?.region,
        "cf.latitude": event.event.request.cf?.latitude,
        "cf.longitude": event.event.request.cf?.longitude,
        "cf.timezone": event.event.request.cf?.timezone,
        duration: event.wallTime,
        request_length: parseInt(event.event.request.headers["content-length"] ?? "0"),
        status: event.event.response?.status ?? 0,
        ip,
        "ip.prefix": ipPrefix(ip),
      }
      const time = new Date(event.eventTimestamp ?? Date.now()).toISOString()
      // This also merges each _metric log into data, so keep it while the Honeycomb export below is disabled.
      const events = [
        ...event.logs.flatMap((log) =>
          log.message.flatMap((message: string) => {
            if (!message.startsWith("_metric:")) return []
            const json = JSON.parse(message.slice(8)) as Record<string, unknown>
            data = { ...data, ...json }
            if ("llm.error.code" in json) {
              return [{ time, data: { ...data, event_type: "llm.error" } }]
            }
            return []
          }),
        ),
        { time, data: { ...data, event_type: "completions" } },
      ]
      console.log(JSON.stringify(data, null, 2))
      void events

      // const honeycomb = await fetch("https://api.honeycomb.io/1/batch/zen", {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     "X-Honeycomb-Team": Resource.HONEYCOMB_API_KEY.value,
      //   },
      //   body: JSON.stringify(events),
      // })
      // console.log(honeycomb.status)
      // console.log(await honeycomb.text())
    }
  },
}

// Returns a stable lookup key for an IP address.
// IPv4: full address as /32 (e.g. "203.0.113.45/32").
// IPv6: the /64 network prefix (e.g. "2001:db8:abcd:1234::/64"). ISPs commonly
// rotate the lower 64 host bits via SLAAC privacy extensions (RFC 8981), so
// grouping by /64 collapses those rotations into one key.
function ipPrefix(ip: string | undefined) {
  if (!ip) return undefined
  if (ip.includes(".") && !ip.includes(":")) return `${ip}/32`
  if (!ip.includes(":")) return undefined

  // Expand "::" to its full form, then keep the first 4 hextets.
  const [head, tail] = ip.split("::") as [string, string | undefined]
  const headParts = head ? head.split(":") : []
  const tailParts = tail !== undefined ? tail.split(":") : []
  const missing = 8 - headParts.length - tailParts.length
  if (missing < 0) return undefined
  const full = [...headParts, ...new Array(missing).fill("0"), ...tailParts]
  if (full.length !== 8) return undefined

  const prefix = full
    .slice(0, 4)
    .map((part) => part.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")
  return `${prefix}::/64`
}
