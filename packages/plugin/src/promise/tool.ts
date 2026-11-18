export { CallID, Error } from "@opencode/schema/tool"
export type { Metadata, Options, Result } from "@opencode/schema/tool"

import { Tool } from "@opencode/schema/tool"
import type { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Types } from "effect"
import type { Hooks, Transform } from "./registration.js"

export interface ToolContext extends Omit<Tool.Context, "progress" | "cancel"> {
  /**
   * Aborted when the call is interrupted, and when the user stops the call if the tool has read this property.
   * Reading it (spreading the context reads it too) opts the tool into a cooperative stop: on the user's stop the
   * signal aborts and whatever the tool then returns or throws is still reported as the call's result. A tool
   * that never reads it, or does not settle soon after the stop, is interrupted.
   */
  readonly signal: AbortSignal
  readonly progress: (update: Tool.Metadata) => Promise<void>
}

export type Info<
  Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
  Output extends Tool.ValueSchema<any> | undefined = Tool.ValueSchema<any> | undefined,
  CMInput extends Tool.ValueSchema<any> = Input,
  CMOutput extends Tool.ValueSchema<any> | undefined = Output,
> = Omit<Tool.Info<Input, Output, CMInput, CMOutput>, "execute"> & {
  readonly execute: (
    input: Parameters<Tool.Info<Input, Output, CMInput, CMOutput>["execute"]>[0],
    context: ToolContext,
  ) => Promise<Tool.Result<Output | CMOutput>>
}

export interface ToolEditor {
  list(): readonly (Info & { readonly id: string })[]
  get(id: string): (Info & { readonly id: string }) | undefined
  namespace(namespace: Tool.Namespace): void
  add<
    Input extends Tool.ValueSchema<any>,
    Output extends Tool.ValueSchema<any> | undefined = undefined,
    CMInput extends Tool.ValueSchema<any> = Input,
    CMOutput extends Tool.ValueSchema<any> | undefined = Output,
  >(
    tool: Info<Input, Output, CMInput, CMOutput>,
  ): void
  /** Updates an existing tool; missing IDs are ignored. */
  update(id: string, update: (tool: Types.Mutable<Info>) => void): void
  remove(id: string): void
}

export interface ToolHooks {
  readonly "execute.before": {
    tool: string
    readonly info?: Info
    readonly codeMode: boolean
    readonly sessionID: Session.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly id: Tool.CallID
    input: unknown
  }
  readonly "execute.after": {
    readonly tool: string
    readonly info?: Info
    readonly codeMode: boolean
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
  /** Currently registered tools, after every transform, keyed by effective name. */
  readonly list: () => Promise<readonly (Info & { readonly id: string })[]>
  readonly hook: Hooks<ToolHooks>
}
