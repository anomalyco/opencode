import type { Tool } from "../effect/tool.js"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import type { JsonSchema, Schema } from "effect"
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
> = {
  readonly name: string
  readonly options?: RegisterOptions
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly structured?: Structured
  readonly toStructuredOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => Schema.Schema.Type<Structured>
  readonly execute: (
    input: Schema.Schema.Type<Input>,
    context: Context,
  ) => Promise<Schema.Schema.Type<Output>>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}

export type DynamicDefinition = {
  readonly name: string
  readonly options?: RegisterOptions
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute: (input: unknown, context: Context) => Promise<DynamicOutput>
}

export type AnyTool = Definition<any, any, any> | DynamicDefinition

export interface ToolExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  input: unknown
}

export interface ToolExecuteAfterEvent {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  readonly input: unknown
  result: Tool.ToolExecuteAfterEvent["result"]
  output?: Tool.ToolExecuteAfterEvent["output"]
  outputPaths?: ReadonlyArray<string>
}

export interface RegisterOptions {
  readonly group?: string
  /** Defaults to true. False exposes the tool directly to the provider. */
  readonly codemode?: boolean
}

export interface ToolDraft {
  add<
    Input extends SchemaType<any>,
    Output extends SchemaType<any>,
    Structured extends SchemaType<any> = Output,
  >(tool: Definition<Input, Output, Structured>): void
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
