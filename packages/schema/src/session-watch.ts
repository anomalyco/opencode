export * as SessionWatch from "./session-watch.js"

import { Schema } from "effect"
import { Session } from "./session.js"

export const Input = Schema.Struct({
  members: Schema.Array(Session.ID).check(Schema.isMinLength(1)),
  text: Schema.String.check(Schema.isPattern(/\S/)),
  enabled: Schema.Boolean,
}).annotate({ identifier: "SessionWatch.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Info = Schema.Struct({ ...Input.fields, sessionID: Session.ID }).annotate({
  identifier: "SessionWatch.Info",
})
export interface Info extends Schema.Schema.Type<typeof Info> {}
