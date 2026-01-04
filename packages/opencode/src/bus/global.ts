import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
  "tui.input.mode.request": [
    {
      sessionID: string
      text: string
      currentMode: "normal" | "shell"
    },
  ]
  "tui.input.mode.response": [
    {
      sessionID: string
      mode: "normal" | "shell"
    },
  ]
}>()
