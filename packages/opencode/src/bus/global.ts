import { EventEmitter } from "events"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

export const GlobalBus = new EventEmitter<{
  event: [GlobalEvent]
}>()

// GlobalBus fans out events to the worker bridge, control-plane waiters, and
// overlapping SSE clients during reconnects, so the default 10-listener limit
// is too low for normal operation.
GlobalBus.setMaxListeners(100)
