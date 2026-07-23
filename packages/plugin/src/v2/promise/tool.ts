import type { Tool } from "../effect/tool.js"
import type { Hooks, Transform } from "./registration.js"

export type Context = Omit<Tool.Context, "progress"> & {
  readonly progress: (update: Tool.Progress) => Promise<void>
}
export type SchemaType<A> = Tool.SchemaType<A>
export type Content = Tool.Content
export type Metadata = Tool.Metadata
export type ModelOutput = Tool.ModelOutput

type BaseDefinition<Input extends SchemaType<any>> = {
  readonly name: string
  readonly description: string
  readonly input: Input
  readonly options?: RegisterOptions
}

export type Definition<
  Input extends SchemaType<any>,
  Output extends SchemaType<any> | undefined = undefined,
> = BaseDefinition<Input> &
  (Output extends SchemaType<any>
    ? {
        readonly output: Output
        readonly execute: (input: Tool.InputValue<Input>, context: Context) => Promise<Tool.Result<Output>>
      }
    : {
        readonly output?: undefined
        readonly execute: (input: Tool.InputValue<Input>, context: Context) => Promise<Tool.ContentResult>
      })

export type AnyTool = Omit<Tool.AnyTool, "execute" | "permission"> & {
  readonly name: string
  readonly options?: RegisterOptions
  readonly execute: (input: any, context: Context) => Promise<Tool.Result<any> | Tool.ContentResult>
}

export type ToolExecuteBeforeEvent = Tool.ToolExecuteBeforeEvent
export type ToolExecuteAfterEvent = Tool.ToolExecuteAfterEvent
export type RegisterOptions = Tool.RegisterOptions

export interface ToolDraft {
  add<Input extends SchemaType<any>, Output extends SchemaType<any>>(tool: Definition<Input, Output>): void
  add<Input extends SchemaType<any>>(tool: Definition<Input>): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
