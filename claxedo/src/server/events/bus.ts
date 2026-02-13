/**
 * Global event bus for broadcasting events to connected clients
 */
import { type GlobalBusEvent, type EventSink } from "./types.ts";

// Set of active event sinks (SSE connections)
const globalEventSinks = new Set<EventSink>();

/**
 * Broadcast an event to all connected clients
 */
export async function broadcastGlobal(event: GlobalBusEvent): Promise<void> {
  const sinks = Array.from(globalEventSinks);
  await Promise.allSettled(sinks.map((send) => send(event)));
}

/**
 * Add an event sink to receive broadcasts
 */
export function addEventSink(sink: EventSink): void {
  globalEventSinks.add(sink);
}

/**
 * Remove an event sink
 */
export function removeEventSink(sink: EventSink): void {
  globalEventSinks.delete(sink);
}

/**
 * Get the number of active event sinks
 */
export function getEventSinkCount(): number {
  return globalEventSinks.size;
}
