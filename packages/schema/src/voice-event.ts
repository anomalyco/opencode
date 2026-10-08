export * as VoiceEvent from "./voice-event.js"

import { Event } from "./event.js"

export const Recording = Event.ephemeral({
  type: "voice.recording",
  schema: {},
})

export const Definitions = Event.inventory(Recording)
