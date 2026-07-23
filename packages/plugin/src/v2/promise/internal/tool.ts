import type { Hooks, Transform } from "../registration.js"

export type Context = Omit<import("../../effect/internal/tool.js").Context, "progress"> & {
  readonly progress: (update: import("../../effect/internal/tool.js").Progress) => Promise<void>
}
export type SchemaType<A> = import("../../effect/internal/tool.js").SchemaType<A>
export type Content = import("../../effect/internal/tool.js").Content
export type Metadata = import("../../effect/internal/tool.js").Metadata
export type ModelOutput = import("../../effect/internal/tool.js").ModelOutput

export type Tool<Input extends SchemaType<any>, Output extends SchemaType<any> | undefined = undefined> = Omit<
  import("../../effect/internal/tool.js").Tool<Input, Output>,
  "execute"
> & {
  readonly execute: (
    input: import("../../effect/internal/tool.js").InputValue<Input>,
    context: Context,
  ) => Promise<
    Output extends SchemaType<any>
      ? import("../../effect/internal/tool.js").Response<Output>
      : import("../../effect/internal/tool.js").ContentResponse
  >
}

export type Any = Omit<import("../../effect/internal/tool.js").Any, "execute"> & {
  readonly execute: (
    input: any,
    context: Context,
  ) => Promise<
    import("../../effect/internal/tool.js").Response<any> | import("../../effect/internal/tool.js").ContentResponse
  >
}

export function make<Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Tool<Input, Output>,
): Tool<Input, Output>
export function make<Input extends SchemaType<any>>(tool: Tool<Input>): Tool<Input>
export function make(tool: Any): Any
export function make(tool: Any): Any {
  return tool
}

export type ToolExecuteBeforeEvent = import("../../effect/internal/tool.js").ToolExecuteBeforeEvent
export type ToolExecuteAfterEvent = import("../../effect/internal/tool.js").ToolExecuteAfterEvent
export type RegisterOptions = import("../../effect/internal/tool.js").RegisterOptions

export interface ToolDraft {
  add<Input extends SchemaType<any>, Output extends SchemaType<any>>(
    name: string,
    tool: Tool<Input, Output>,
    options?: RegisterOptions,
  ): void
  add<Input extends SchemaType<any>>(name: string, tool: Tool<Input>, options?: RegisterOptions): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
