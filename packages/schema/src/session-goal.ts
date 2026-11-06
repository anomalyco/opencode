export * as SessionGoal from "./session-goal.js"

import { Schema } from "effect"

export const Status = Schema.Literals(["active", "paused", "blocked", "complete"])
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  objective: Schema.String.check(Schema.isMinLength(1)),
  status: Status,
  reason: Schema.optionalKey(Schema.String),
  awaitingApproval: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Session.Goal" })

export const Update = Schema.Struct({
  objective: Schema.optionalKey(Info.fields.objective),
  status: Schema.optionalKey(Status),
  reason: Schema.optionalKey(Schema.String),
  awaitingApproval: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Session.Goal.Update" })
export interface Update extends Schema.Schema.Type<typeof Update> {}

export const Monitor = Schema.Struct({
  goal: Schema.NullOr(Info),
  continuationCount: Schema.Number,
  approvalWaits: Schema.Number,
}).annotate({ identifier: "Session.Goal.Monitor" })
export interface Monitor extends Schema.Schema.Type<typeof Monitor> {}
