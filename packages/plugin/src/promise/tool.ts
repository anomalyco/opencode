export { CallID, Error } from "@opencode-ai/schema/tool"
export type { Metadata, Options, Result } from "@opencode-ai/schema/tool"

import { Tool } from "@opencode-ai/schema/tool"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { Types } from "effect"
import type { Hooks, Transform } from "./registration.js"

export interface ToolContext extends Omit<Tool.Context, "progress"> {
  readonly progress: (update: Tool.Metadata) => Promise<void>
}

export type Info<
  Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
  Output extends Tool.ValueSchema<any> | undefined = Tool.ValueSchema<any> | undefined,
> = Omit<Tool.Info<Input, Output>, "execute"> & {
  readonly execute: (
    input: Parameters<Tool.Info<Input, Output>["execute"]>[0],
    context: ToolContext,
  ) => Promise<Tool.Result<Output>>
}

interface ToolEditor {
  list(): readonly (Info & { readonly id: string })[]
  get(id: string): (Info & { readonly id: string }) | undefined
  namespace(namespace: Tool.Namespace): void
  add<Input extends Tool.ValueSchema<any>, Output extends Tool.ValueSchema<any> | undefined>(
    tool: Info<Input, Output>,
  ): void
  /** Updates an existing tool; missing IDs are ignored. */
  update(id: string, update: (tool: Types.Mutable<Info>) => void): void
  remove(id: string): void
}

interface ToolHooks {
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

export interface ToolDomain {
  readonly transform: Transform<ToolEditor>
  readonly reload: () => Promise<void>
  readonly hook: Hooks<ToolHooks>
}
