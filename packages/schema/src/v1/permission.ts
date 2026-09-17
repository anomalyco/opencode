export * as PermissionV1 from "./permission"

import { Schema } from "effect"
import { define, inventory } from "../event"
import { ascending } from "../identifier"
import { Project } from "../project"
import { statics } from "../schema"
import { SessionID } from "../session-id"

export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("PermissionID"),
  statics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionAction" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({ permission: Schema.String, pattern: Schema.String, action: Action }).annotate({
  identifier: "PermissionRule",
})
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = typeof Ruleset.Type

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(Schema.Struct({ messageID: Schema.String, callID: Schema.String })),
}).annotate({ identifier: "PermissionRequest" })
export type Request = typeof Request.Type

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = typeof Reply.Type

export const ReplyBody = Schema.Struct({ reply: Reply, message: Schema.optional(Schema.String) }).annotate({
  identifier: "PermissionReplyBody",
})
export type ReplyBody = typeof ReplyBody.Type

export const Approval = Schema.Struct({ projectID: Project.ID, patterns: Schema.Array(Schema.String) }).annotate({
  identifier: "PermissionApproval",
})
export type Approval = typeof Approval.Type

export const AskInput = Schema.Struct({ ...Request.fields, id: Schema.optional(ID), ruleset: Ruleset }).annotate({
  identifier: "PermissionAskInput",
})
export type AskInput = typeof AskInput.Type

export const ReplyInput = Schema.Struct({ requestID: ID, ...ReplyBody.fields }).annotate({
  identifier: "PermissionReplyInput",
})
export type ReplyInput = typeof ReplyInput.Type

const Asked = define({ type: "permission.asked", schema: Request.fields })
const Replied = define({
  type: "permission.replied",
  schema: { sessionID: SessionID, requestID: ID, reply: Reply },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }
