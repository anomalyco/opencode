export * as SessionTransfer from "./session-transfer.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"
import { optional } from "./schema.js"

export interface Data extends Schema.Schema.Type<typeof Data> {}
export const Data = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(SessionMessage.Info),
}).annotate({ identifier: "SessionTransfer.Data" })

// Older exports omitted the compaction model. Only the import boundary accepts
// this shape; Core fills the model before storing it under the current contract.
export interface Import extends Schema.Schema.Type<typeof Import> {}
export const Import = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(
    Schema.Union([
      ...SessionMessage.Info.members,
      Schema.Struct({
        ...SessionMessage.CompactionCompleted.fields,
        model: SessionMessage.CompactionCompleted.fields.model.pipe(optional),
      }),
    ]),
  ),
}).annotate({ identifier: "SessionTransfer.Import" })
