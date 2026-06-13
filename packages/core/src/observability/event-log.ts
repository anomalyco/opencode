// Opt-in structured event log. Appends every EventV2 event as one JSON line to
// `${Global.Path.log}/events.jsonl`, using the native event system — no OpenTelemetry, no network.
// Enable with `OPENCODE_EVENT_LOG=1`. It is emitted through the existing global listener in
// `packages/opencode/src/event-v2-bridge.ts`, so it runs wherever that bridge is composed.
import { appendFileSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { EventV2 } from "../event"
import { Global } from "../global"

const file = path.join(Global.Path.log, "events.jsonl")

export const enabled = process.env["OPENCODE_EVENT_LOG"] === "1"

export function format(event: EventV2.Payload): string {
  return (
    JSON.stringify({
      time: Date.now(),
      id: event.id,
      type: event.type,
      seq: event.seq,
      directory: event.location?.directory,
      data: event.data,
    }) + "\n"
  )
}

// Best-effort: a failure to write the debug log must never disturb event delivery. The global
// listener also isolates errors, so this is belt-and-suspenders.
export function record(event: EventV2.Payload): Effect.Effect<void> {
  if (!enabled) return Effect.void
  // best-effort: swallow write errors so the debug log can never disturb event delivery
  return Effect.sync(() => {
    try {
      appendFileSync(file, format(event))
    } catch {
      // ignore: the event log is a best-effort debug sink
    }
  })
}

export * as EventLog from "./event-log"
