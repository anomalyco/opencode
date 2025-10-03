import { Storage } from "../storage/storage"
import type { TelemetryEvent } from "./telemetry-event"

const KEY = ["telemetry", "tools"]
const MAX_EVENTS = 200

type TelemetrySummary = {
  version: 1
  tools: Record<string, { runs: number; errors: number; totalDuration: number }>
  events: TelemetryEvent[]
}

async function ensure(): Promise<TelemetrySummary> {
  try {
    return await Storage.read<TelemetrySummary>(KEY)
  } catch {
    const fresh: TelemetrySummary = { version: 1, tools: {}, events: [] }
    await Storage.write(KEY, fresh)
    return fresh
  }
}

async function write(summary: TelemetrySummary) {
  await Storage.write(KEY, summary)
}

export namespace ToolHistory {
  export async function record(event: TelemetryEvent) {
    const summary = await ensure()
    const entry = (summary.tools[event.id] ??= { runs: 0, errors: 0, totalDuration: 0 })
    entry.runs += 1
    entry.totalDuration += event.duration
    if (event.status === "error") entry.errors += 1

    summary.events.push(event)
    if (summary.events.length > MAX_EVENTS) {
      summary.events.splice(0, summary.events.length - MAX_EVENTS)
    }
    await write(summary)
  }

  export async function read(): Promise<TelemetrySummary> {
    return ensure()
  }
}
