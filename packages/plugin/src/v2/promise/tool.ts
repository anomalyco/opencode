export * as Tool from "./tool.js"

import type { Tool } from "../effect/tool.js"
import type { Hooks, Transform } from "./registration.js"

export type Context = Omit<Tool.Context, "progress"> & {
  readonly progress: (update: Tool.Progress) => Promise<void>
}
export type SchemaType<A> = Tool.SchemaType<A>
export type Content = Tool.Content
export type Metadata = Tool.Metadata
export type ModelOutput = Tool.ModelOutput

export type Definition<Input extends SchemaType<any>, Output extends SchemaType<any> | undefined = undefined> = Omit<
  Tool.Definition<Input, Output>,
  "execute"
> & {
  readonly execute: (
    input: Tool.InputValue<Input>,
    context: Context,
  ) => Promise<Output extends SchemaType<any> ? Tool.Response<Output> : Tool.ContentResponse>
}

export type AnyDefinition = Omit<Tool.AnyDefinition, "execute"> & {
  readonly execute: (input: any, context: Context) => Promise<Tool.Response<any> | Tool.ContentResponse>
}

export function make<Input extends SchemaType<any>, Output extends SchemaType<any>>(
  definition: Definition<Input, Output>,
): Definition<Input, Output>
export function make<Input extends SchemaType<any>>(definition: Definition<Input>): Definition<Input>
export function make(definition: AnyDefinition): AnyDefinition
export function make(definition: AnyDefinition): AnyDefinition {
  return definition
}

export type ToolExecuteBeforeEvent = Tool.ToolExecuteBeforeEvent
export type ToolExecuteAfterEvent = Tool.ToolExecuteAfterEvent
export type RegisterOptions = Tool.RegisterOptions

export interface ToolDraft {
  add<Input extends SchemaType<any>, Output extends SchemaType<any>>(
    name: string,
    definition: Definition<Input, Output>,
    options?: RegisterOptions,
  ): void
  add<Input extends SchemaType<any>>(name: string, definition: Definition<Input>, options?: RegisterOptions): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
