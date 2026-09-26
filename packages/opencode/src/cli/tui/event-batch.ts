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

function deltaKey(event: GlobalEvent, properties: DeltaProperties): string {
  return [
    event.directory,
    event.project,
    event.workspace,
    properties.sessionID,
    properties.messageID,
    properties.partID,
    properties.field,
  ].join("\0")
}

function partReplacementID(event: GlobalEvent): string | undefined {
  const payload = event.payload
  if (!payload || typeof payload !== "object") return
  if (payload.type === "message.updated" || payload.type === "message.removed" || payload.type === "session.deleted")
    return "*"
  if (payload.type !== "message.part.updated" && payload.type !== "message.part.removed") return
  const properties = payload.properties
  if (!properties || typeof properties !== "object") return
  if (typeof properties.partID === "string") return properties.partID
  const part = properties.part
  if (part && typeof part === "object" && typeof part.id === "string") return part.id
}

// Folds part deltas for the same part field into single events even when other
// lanes interleave between them. A part update or removal for the same part
// invalidates its pending delta so appended text can never reorder across a
// full-part replacement.
export function collapseEventBatch(events: GlobalEvent[]): GlobalEvent[] {
  return events.reduce<{ collapsed: GlobalEvent[]; keys: Map<string, number> }>(
    (state, event) => {
      const delta = deltaProperties(event)
      if (delta) {
        const key = deltaKey(event, delta)
        const index = state.keys.get(key)
        const previous = index === undefined ? undefined : state.collapsed[index]
        const merged = previous ? mergeDelta(previous, event) : undefined
        if (merged && index !== undefined) {
          state.collapsed[index] = merged
          return state
        }
        state.keys.set(key, state.collapsed.length)
        state.collapsed.push(event)
        return state
      }
      const partID = partReplacementID(event)
      if (partID === "*") state.keys.clear()
      else if (partID) {
        for (const [key, index] of state.keys) {
          const pending = state.collapsed[index]
          if (pending && deltaProperties(pending)?.partID === partID) state.keys.delete(key)
        }
      }
      state.collapsed.push(event)
      return state
    },
    { collapsed: [], keys: new Map() },
  ).collapsed
}

// The event bridge mirrors every durable event as a second "sync" payload for
// the workspace sync consumers; the TUI ignores those copies on receipt, so
// they never need to cross the RPC boundary.
export function shouldForwardEvent(event: GlobalEvent): boolean {
  return event.payload?.type !== "sync"
}
