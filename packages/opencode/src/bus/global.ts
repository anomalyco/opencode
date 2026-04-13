import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      project?: string
      workspace?: string
      payload: any
    },
  ]
}>()
