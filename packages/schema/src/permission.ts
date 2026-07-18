export * as Permission from "./permission"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { SessionID } from "./session-id"
import { statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("PermissionV2.ID"),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    messageID: Schema.String,
    callID: Schema.String,
  }),
]).annotate({ identifier: "PermissionV2.Source" })
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: SessionID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  save: Schema.Array(Schema.String).pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  source: Source.pipe(optional),
}

export const Request = Schema.Struct({
  id: ID,
  ...RequestFields,
}).annotate({ identifier: "PermissionV2.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Reply = Schema.Literals(["once", "always", "reject"]).annotate({ identifier: "PermissionV2.Reply" })
export type Reply = typeof Reply.Type

const Asked = define({ type: "permission.v2.asked", schema: Request.fields })
const Replied = define({
  type: "permission.v2.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    reply: Reply,
  },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }

export const Effect = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionV2.Effect" })
export type Effect = typeof Effect.Type

export interface Rule extends Schema.Schema.Type<typeof Rule> {}
export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
}).annotate({ identifier: "PermissionV2.Rule" })

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionV2.Ruleset" })
export type Ruleset = typeof Ruleset.Type
