import { Tool } from "@opencode/schema/tool"
import type { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Effect, Scope, Types } from "effect"
import type { Hooks, Registration } from "./registration.js"

export interface ToolScope {
  /** Limits the registration or read to one Session. Unscoped registrations apply to every Session. */
  readonly sessionID?: Session.ID
}

export interface ToolEditor {
  list(): readonly (Tool.Info & { readonly id: string })[]
  get(id: string): (Tool.Info & { readonly id: string }) | undefined
  namespace(namespace: Tool.Namespace): void
  add<Input extends Tool.ValueSchema<any>, Output extends Tool.ValueSchema<any> | undefined>(
    tool: Tool.Info<Input, Output>,
  ): void
  /** Updates an existing tool; missing IDs are ignored. */
  update(id: string, update: (tool: Types.Mutable<Tool.Info>) => void): void
  remove(id: string): void
}

export interface ToolHooks {
  readonly "execute.before": {
    tool: string
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly id: Tool.CallID
    input: unknown
  }
  readonly "execute.after": {
    readonly tool: string
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly id: Tool.CallID
    readonly input: unknown
  } & (
    | {
        readonly status: "completed"
        result: Tool.Result
      }
    | {
        readonly status: "error"
        error: Tool.Error
      }
  )
}

// Only execute.before may fail: a Tool.Error rejects the call before the tool runs.
export interface ToolFailures extends Record<keyof ToolHooks, unknown> {
  readonly "execute.before": Tool.Error
  readonly "execute.after": never
}

export interface ToolDomain {
  /** Session-scoped transforms replay after every unscoped transform, only for that Session. */
  readonly transform: (
    callback: (editor: ToolEditor) => void,
    scope?: ToolScope,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly reload: () => Effect.Effect<void>
  /** Currently registered tools, after every transform, keyed by effective name. */
  readonly list: (scope?: ToolScope) => Effect.Effect<readonly (Tool.Info & { readonly id: string })[]>
  readonly hook: Hooks<ToolHooks, ToolFailures>
}
