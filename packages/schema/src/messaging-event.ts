export * as MessagingEvent from "./messaging-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Sent = Event.define({
  type: "messaging.sent",
  schema: {
    childSessionID: SessionID,
    parentSessionID: SessionID,
    body: Schema.String,
    expectReply: Schema.Boolean,
  },
})

export const Replied = Event.define({
  type: "messaging.replied",
  schema: {
    childSessionID: SessionID,
    parentSessionID: SessionID,
    body: Schema.String,
  },
})

export const Rejected = Event.define({
  type: "messaging.rejected",
  schema: {
    childSessionID: SessionID,
  },
})

export const Definitions = Event.inventory(Sent, Replied, Rejected)
