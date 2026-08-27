import { Tool } from "@opencode-ai/schema/tool"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Effect, JsonSchema } from "effect"
import type { Hooks, Transform } from "./registration.js"

export interface ToolDraft {
  add<Input extends Tool.ValueSchema<any>, Output extends Tool.ValueSchema<any> | undefined>(
    tool: Tool.Info<Input, Output>,
  ): void
}

export interface ToolHooks {
  readonly "execute.before": {
    readonly tool: string
    readonly inputSchema: JsonSchema.JsonSchema
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
  readonly transform: Transform<ToolDraft>
  readonly reload: () => Effect.Effect<void>
  readonly hook: Hooks<ToolHooks, ToolFailures>
}
