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
        continue

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
        ip: event.event.request.headers["x-real-ip"],
      }
      const time = new Date(event.eventTimestamp ?? Date.now()).toISOString()
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

      const lakeIngest = getLakeIngest()
      const [honeycomb, lake] = await Promise.all([
        fetch("https://api.honeycomb.io/1/batch/zen", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Honeycomb-Team": Resource.HONEYCOMB_API_KEY.value,
          },
          body: JSON.stringify(events),
        }),
        ...(lakeIngest
          ? [
              fetch(lakeIngest.url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${lakeIngest.secret}`,
                },
                body: JSON.stringify({ events: events.map((event) => toLakeEvent(event.time, event.data)) }),
              }),
            ]
          : []),
      ])
      console.log(honeycomb.status)
      console.log(await honeycomb.text())
      if (lake) {
        console.log(lake.status)
        console.log(await lake.text())
      }
    }
  },
}

function getLakeIngest(): { url: string; secret: string } | undefined {
  try {
    return Resource.LakeIngest
  } catch {
    return undefined
  }
}

function toLakeEvent(time: string, data: Record<string, unknown>) {
  return {
    _datalake_key: "inference.event",
    event_timestamp: time,
    event_date: time.slice(0, 10),
    event_type: string(data, "event_type"),
    dataset: "zen",
    cf_continent: string(data, "cf.continent"),
    cf_country: string(data, "cf.country"),
    cf_city: string(data, "cf.city"),
    cf_region: string(data, "cf.region"),
    cf_latitude: number(data, "cf.latitude"),
    cf_longitude: number(data, "cf.longitude"),
    cf_timezone: string(data, "cf.timezone"),
    duration: number(data, "duration"),
    request_length: integer(data, "request_length"),
    status: integer(data, "status"),
    ip: string(data, "ip"),
    is_stream: boolean(data, "is_stream"),
    session: string(data, "session"),
    request: string(data, "request"),
    client: string(data, "client"),
    user_agent: string(data, "user_agent"),
    model_variant: string(data, "model.variant"),
    source: string(data, "source"),
    provider: string(data, "provider"),
    provider_model: string(data, "provider.model"),
    model: string(data, "model"),
    llm_error_code: integer(data, "llm.error.code"),
    llm_error_message: string(data, "llm.error.message"),
    error_response: string(data, "error.response"),
    error_type: string(data, "error.type"),
    error_message: string(data, "error.message"),
    error_cause: string(data, "error.cause"),
    error_cause2: string(data, "error.cause2"),
    api_key: string(data, "api_key"),
    workspace: string(data, "workspace"),
    is_subscription: boolean(data, "isSubscription"),
    subscription: string(data, "subscription"),
    response_length: integer(data, "response_length"),
    time_to_first_byte: integer(data, "time_to_first_byte"),
    timestamp_first_byte: integer(data, "timestamp.first_byte"),
    timestamp_last_byte: integer(data, "timestamp.last_byte"),
    tokens_input: integer(data, "tokens.input"),
    tokens_output: integer(data, "tokens.output"),
    tokens_reasoning: integer(data, "tokens.reasoning"),
    tokens_cache_read: integer(data, "tokens.cache_read"),
    tokens_cache_write_5m: integer(data, "tokens.cache_write_5m"),
    tokens_cache_write_1h: integer(data, "tokens.cache_write_1h"),
    cost_input_microcents: integer(data, "cost.input.microcents"),
    cost_output_microcents: integer(data, "cost.output.microcents"),
    cost_cache_read_microcents: integer(data, "cost.cache_read.microcents"),
    cost_cache_write_microcents: integer(data, "cost.cache_write.microcents"),
    cost_total_microcents: integer(data, "cost.total.microcents"),
    cost_input: integer(data, "cost.input"),
    cost_output: integer(data, "cost.output"),
    cost_cache_read: integer(data, "cost.cache_read"),
    cost_cache_write_5m: integer(data, "cost.cache_write_5m"),
    cost_cache_write_1h: integer(data, "cost.cache_write_1h"),
    cost_total: integer(data, "cost.total"),
  }
}

function string(data: Record<string, unknown>, key: string) {
  const value = data[key]
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function boolean(data: Record<string, unknown>, key: string) {
  const value = data[key]
  if (typeof value === "boolean") return value
  if (typeof value === "string") return value === "true" ? true : value === "false" ? false : undefined
  return undefined
}

function integer(data: Record<string, unknown>, key: string) {
  const value = number(data, key)
  if (value === undefined) return undefined
  return Math.round(value)
}

function number(data: Record<string, unknown>, key: string) {
  const value = data[key]
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
