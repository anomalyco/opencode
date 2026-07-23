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

export type Declaration<
  Input extends SchemaType<any>,
  Output extends SchemaType<any> | undefined = undefined,
> = Omit<Tool.Declaration<Input, Output>, "execute"> & {
  readonly execute: (
    input: Tool.InputValue<Input>,
    context: Context,
  ) => Promise<Output extends SchemaType<any> ? Tool.Response<Output> : Tool.ContentResponse>
}

export type AnyDeclaration = Omit<Tool.AnyDeclaration, "execute"> & {
  readonly execute: (input: any, context: Context) => Promise<Tool.Response<any> | Tool.ContentResponse>
}

export function make<Input extends SchemaType<any>, Output extends SchemaType<any>>(
  declaration: Declaration<Input, Output>,
): Declaration<Input, Output>
export function make<Input extends SchemaType<any>>(declaration: Declaration<Input>): Declaration<Input>
export function make(declaration: AnyDeclaration): AnyDeclaration
export function make(declaration: AnyDeclaration): AnyDeclaration {
  return declaration
}

export type ToolExecuteBeforeEvent = Tool.ToolExecuteBeforeEvent
export type ToolExecuteAfterEvent = Tool.ToolExecuteAfterEvent
export type RegisterOptions = Tool.RegisterOptions

export interface ToolDraft {
  add<Input extends SchemaType<any>, Output extends SchemaType<any>>(
    name: string,
    declaration: Declaration<Input, Output>,
    options?: RegisterOptions,
  ): void
  add<Input extends SchemaType<any>>(name: string, declaration: Declaration<Input>, options?: RegisterOptions): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
