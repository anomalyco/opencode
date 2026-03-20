import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: { type: string; properties: Record<string, unknown> }
    },
  ]
}>()
