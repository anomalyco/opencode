export * as SessionTransfer from "./session-transfer.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"

export interface Data extends Schema.Schema.Type<typeof Data> {}
export const Data = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(SessionMessage.Info),
}).annotate({ identifier: "SessionTransfer.Data" })
