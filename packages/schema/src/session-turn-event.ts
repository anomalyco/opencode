export * as SessionTurnEvent from "./session-turn-event"

import { Schema } from "effect"
import { optional } from "./schema"
import { Event } from "./event"
import { SessionID } from "./session-id"

// D5: terminal reconciliation event emitted at the end of every prompt-loop
// exit path (break, error, abort). Session status semantics are unchanged —
// this is the additive channel for consumers (graders, routers) to reconcile
// reported status against on-disk artifacts: `parts_written` counts the
// turn's successfully completed file-writing tool parts, so an error after
// successful writes is distinguishable from a turn that produced nothing.
export const Completed = Event.define({
  type: "session.turn.completed",
  schema: {
    sessionID: SessionID,
    status: Schema.Literals(["idle", "error"]),
    parts_written: Schema.Finite,
    last_error: optional(Schema.String),
  },
})

export const Definitions = Event.inventory(Completed)
