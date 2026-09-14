import type { GlobalEvent } from "@/bus/global"

// Flush interval and cap for worker -> TUI event forwarding. A short interval
// keeps delivery latency imperceptible (the TUI renders on its own 16ms batch)
// while collapsing a fast stream into one cross-thread message per flush.
export const EVENT_BATCH_INTERVAL = 16
export const EVENT_BATCH_LIMIT = 512

type DeltaProperties = {
  sessionID?: string
  messageID?: string
  partID?: string
  field?: string
  delta?: string
}

function deltaProperties(event: GlobalEvent): DeltaProperties | undefined {
  const payload = event.payload
  if (!payload || typeof payload !== "object" || payload.type !== "message.part.delta") return
  const properties = payload.properties
  if (!properties || typeof properties !== "object") return
  return properties
}

function mergeDelta(left: GlobalEvent, right: GlobalEvent): GlobalEvent | undefined {
  const a = deltaProperties(left)
  const b = deltaProperties(right)
  if (!a || !b) return
  if (left.directory !== right.directory || left.project !== right.project || left.workspace !== right.workspace) return
  if (a.sessionID !== b.sessionID || a.messageID !== b.messageID || a.partID !== b.partID || a.field !== b.field) return
  if (typeof a.delta !== "string" || typeof b.delta !== "string") return
  // Concatenating adjacent chunks preserves the final part field value: applying
  // one merged delta equals applying the two originals in order.
  return {
    ...left,
    payload: { ...left.payload, properties: { ...a, delta: a.delta + b.delta } },
  }
}

// Folds runs of adjacent part deltas for the same part field into single events.
// Non-delta events never merge, and only adjacent events merge, so stream order
// is preserved for every consumer.
export function collapseEventBatch(events: GlobalEvent[]): GlobalEvent[] {
  return events.reduce<GlobalEvent[]>((collapsed, event) => {
    const previous = collapsed[collapsed.length - 1]
    const merged = previous ? mergeDelta(previous, event) : undefined
    if (merged) collapsed[collapsed.length - 1] = merged
    else collapsed.push(event)
    return collapsed
  }, [])
}
