import { EventEmitter } from "events"

/**
 * Global event bus for cross-instance communication.
 *
 * Used to broadcast events between different parts of the application,
 * particularly for events that need to be tracked globally across
 * multiple project instances.
 *
 * @example
 * ```typescript
 * GlobalBus.emit("event", { directory: "/project", payload: { type: "update" } })
 * GlobalBus.on("event", ({ directory, payload }) => {
 *   console.log("Event from", directory, payload)
 * })
 * ```
 */
export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()
