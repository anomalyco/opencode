import type { Tool } from "../effect/tool.js"
import type { Hooks, Transform } from "./registration.js"

export type Context = Omit<Tool.Context, "progress"> & {
  readonly progress: (update: Tool.Progress) => Promise<void>
}
export type SchemaType<A> = Tool.SchemaType<A>
export type Content = Tool.Content
export type DynamicOutput = Tool.DynamicOutput

export type Definition<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
> = Omit<Tool.Definition<Input, Structured, Output>, "execute" | "permission"> & {
  readonly name: string
  readonly options?: RegisterOptions
  readonly execute: (input: Tool.InputValue<Input>, context: Context) => Promise<Tool.OutputValue<Output>>
}

export type DynamicDefinition = Omit<Tool.DynamicDefinition, "execute" | "permission"> & {
  readonly name: string
  readonly options?: RegisterOptions
  readonly execute: (input: unknown, context: Context) => Promise<DynamicOutput>
}

export type AnyTool = Definition<any, any, any> | DynamicDefinition

export type ToolExecuteBeforeEvent = Tool.ToolExecuteBeforeEvent
export type ToolExecuteAfterEvent = Tool.ToolExecuteAfterEvent
export type RegisterOptions = Tool.RegisterOptions

export interface ToolDraft {
  add<Input extends SchemaType<any>, Output extends SchemaType<any>, Structured extends SchemaType<any> = Output>(
    tool: Definition<Input, Output, Structured>,
  ): void
  add(tool: DynamicDefinition): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
