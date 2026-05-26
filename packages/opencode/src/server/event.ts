import { EventV2 } from "@opencode-ai/core/event"

export const Event = {
  Connected: EventV2.define({ type: "server.connected", schema: {} }),
  Disposed: EventV2.define({ type: "global.disposed", schema: {} }),
}
