import { DateTime } from "effect"
import * as Sse from "effect/unstable/encoding/Sse"

// Serialize a bus/global event payload into an SSE frame for the `/event` and
// `/global/event` streams.
export function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(encodeDateTimes(data)),
  }
}

// `DateTime.toJSON()` emits ISO 8601 strings, but every event schema declares
// timestamps as epoch-millis numbers (`V2Schema.DateTimeUtcFromMillis`). Encode
// any `DateTime` to epoch millis so the wire form matches the OpenAPI spec.
// See https://github.com/anomalyco/opencode/issues/28847.
function encodeDateTimes(value: unknown): unknown {
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value)
  if (Array.isArray(value)) return value.map(encodeDateTimes)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeDateTimes(item)]))
  }
  return value
}
