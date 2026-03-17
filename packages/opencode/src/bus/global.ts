import { EventEmitter } from "events"

/**
 * Global event bus for cross-instance communication.
 *
 * Used to broadcast events between different OpenCode instances,
 * enabling coordination across multiple directories.
 */
export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()
