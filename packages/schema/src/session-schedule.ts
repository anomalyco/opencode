export * as SessionSchedule from "./session-schedule.js"

import { Schema } from "effect"
import { PositiveInt } from "./schema.js"
import { Session } from "./session.js"

export const Input = Schema.Struct({
  text: Schema.String.check(Schema.isPattern(/\S/)),
  intervalMinutes: PositiveInt,
  enabled: Schema.Boolean,
}).annotate({ identifier: "SessionSchedule.Input" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Info = Schema.Struct({
  ...Input.fields,
  id: Schema.String,
  sessionID: Session.ID,
  nextAt: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "SessionSchedule.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
