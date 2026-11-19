import { Agent } from "@opencode/schema/agent"
import { Permission } from "@opencode/schema/permission"
import { Schema } from "effect"

export const AssertInput = Schema.Struct({
  sessionID: Permission.Request.fields.sessionID,
  agent: Agent.ID.pipe(Schema.optional),
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
})
export interface AssertInput extends Schema.Schema.Type<typeof AssertInput> {}

/** A request-scoped automatic review. Approval never grants a saved permission. Experimental. */
export const ReviewResult = Schema.Struct({
  decision: Schema.Literals(["approve", "deny", "escalate"]),
  reason: Schema.String.check(Schema.isMinLength(1)),
})
export interface ReviewResult extends Schema.Schema.Type<typeof ReviewResult> {}

/** Runs only for actual requests that still need approval, after permission rules and policy hooks. */
export interface PermissionReview {
  readonly request: Permission.Request
  readonly agent?: Agent.ID
  result?: ReviewResult
}
