export * as PermissionV1 from "./permission"

import { Schema } from "effect"
import { define, inventory } from "../event"
import { ascending } from "../identifier"
import { Project } from "../project"
import { NonNegativeInt, PositiveInt, statics } from "../schema"
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

// Auto mode is an ephemeral lease rather than a rule or a server-wide flag. A
// lease turns requests that would resolve to `ask` into `allow` *before*
// `permission.asked` is published, so that event keeps meaning "a human has to
// respond". Explicit `deny` rules are evaluated first and are never affected.
export const AutoLeaseID = Schema.String.check(Schema.isStartsWith("pal")).pipe(
  Schema.brand("PermissionAutoLeaseID"),
  statics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "pal_" + ascending()) })),
)
export type AutoLeaseID = typeof AutoLeaseID.Type

// `instance` matches what the TUI does today: everything in the connected
// directory. `session` covers one session plus every session descended from it,
// which is what a single `opencode run --auto` invocation owns.
export const AutoScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("instance") }),
  Schema.Struct({ type: Schema.Literal("session"), sessionID: SessionID }),
]).annotate({ identifier: "PermissionAutoScope" })
export type AutoScope = typeof AutoScope.Type

// A lease only survives while its owner keeps renewing it, so a client that
// crashes, is SIGKILLed, or loses the network cannot leave auto mode on.
export const AUTO_LEASE_TTL_DEFAULT = 30_000
export const AUTO_LEASE_TTL_MIN = 1_000
export const AUTO_LEASE_TTL_MAX = 300_000

export const AutoLease = Schema.Struct({
  id: AutoLeaseID,
  scope: AutoScope,
  // Milliseconds the lease survives without a renewal, and the wall clock time
  // it lapses at. Owners should renew well inside `ttl`.
  ttl: NonNegativeInt,
  expires: NonNegativeInt,
}).annotate({ identifier: "PermissionAutoLease" })
export type AutoLease = typeof AutoLease.Type

export const AutoAcquireBody = Schema.Struct({
  scope: AutoScope,
  ttl: Schema.optional(PositiveInt),
}).annotate({ identifier: "PermissionAutoAcquireBody" })
export type AutoAcquireBody = typeof AutoAcquireBody.Type

const Asked = define({ type: "permission.asked", schema: Request.fields })
const Replied = define({
  type: "permission.replied",
  schema: { sessionID: SessionID, requestID: ID, reply: Reply },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }
