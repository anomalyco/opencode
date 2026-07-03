export * as SessionCompactionEvent from "./session-compaction-event.js"

import { Event } from "./event.js"
import { SessionID } from "./session-id.js"

export const Compacted = Event.ephemeral({
  type: "session.compacted",
  schema: {
    sessionID: SessionID,
  },
})

export const Definitions = Event.inventory(Compacted)
