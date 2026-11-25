import { Agent } from "@opencode/schema/agent"
import { Permission } from "@opencode/schema/permission"
import type { Session } from "@opencode/schema/session"
import { Schema } from "effect"

/** A trusted adapter's verified correspondence between workspace paths and their resolved paths. */
export interface WorkspaceReadScope {
  readonly members: ReadonlyArray<{ readonly logical: string; readonly physical: string }>
}

/** An empty `scopes` array means unmanaged; `null` records a failed managed binding. */
export interface WorkspaceReadScopeHook {
  readonly sessionID: Session.ID
  readonly directory: string
  readonly scopes: Array<WorkspaceReadScope | null>
}

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
