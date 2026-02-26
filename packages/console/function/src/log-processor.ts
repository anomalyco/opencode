import { Resource } from "@opencode-ai/console-resource"
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
        return

      let data = {
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
        ip: event.event.request.headers["x-real-ip"],
      }
      const time = new Date(event.eventTimestamp ?? Date.now()).toISOString()
      const events = []
      for (const log of event.logs) {
        for (const message of log.message) {
          if (!message.startsWith("_metric:")) continue
          const json = JSON.parse(message.slice(8))
          data = { ...data, ...json }
          if ("llm.error.code" in json) {
            events.push({ time, data: { ...data, event_type: "llm.error" } })
          }
        }
      }
      events.push({ time, data: { ...data, event_type: "completions" } })
      console.log(JSON.stringify(data, null, 2))

      const ret = await fetch("https://api.honeycomb.io/1/batch/zen", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Honeycomb-Team": Resource.HONEYCOMB_API_KEY.value,
        },
        body: JSON.stringify(events),
      })
      console.log(ret.status)
      console.log(await ret.text())
    }
  },
}
