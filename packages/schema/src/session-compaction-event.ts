export * as SessionCompactionEvent from "./session-compaction-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Compacted = Event.define({
  type: "session.compacted",
  schema: {
    sessionID: SessionID,
  },
})

// D3: compaction lifecycle with token figures. `before_tokens` is the
// estimate over the messages entering compaction; `after_tokens` is the
// estimate over the retained tail (the fresh summary text is not counted).
export const Started = Event.define({
  type: "session.compaction.started",
  schema: {
    sessionID: SessionID,
    before_tokens: Schema.Finite,
  },
})

export const Completed = Event.define({
  type: "session.compaction.completed",
  schema: {
    sessionID: SessionID,
    before_tokens: Schema.Finite,
    after_tokens: optional(Schema.Finite),
  },
})

export const Definitions = Event.inventory(Compacted, Started, Completed)
