export * as TaskEvent from "./task-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Completed = Event.define({
  type: "task.completed",
  schema: {
    sessionID: SessionID,
    parentSessionID: SessionID,
    status: Schema.Literals(["ok", "error", "aborted"]),
  },
})

export const Definitions = Event.inventory(Completed)
