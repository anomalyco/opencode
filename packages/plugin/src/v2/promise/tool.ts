export * as Tool from "./tool.js"

import { Tool } from "../effect/tool.js"
import type { ToolOutput, ToolResultValue } from "@opencode-ai/llm"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, type JsonSchema, type Schema } from "effect"
import type { Hooks, Transform } from "./registration.js"

export type Context = Tool.Context
export type SchemaType<A> = Tool.SchemaType<A>
export type Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> = Tool.Definition<Input, Output>
export type AnyTool = Tool.AnyTool
export const Failure = Tool.Failure
export type Failure = Tool.Failure
export const RegistrationError = Tool.RegistrationError
export type RegistrationError = Tool.RegistrationError
export type Content = Tool.Content
export type DynamicOutput = Tool.DynamicOutput

type Config<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
> = {
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

type DynamicConfig = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute: (input: unknown, context: Context) => Promise<DynamicOutput>
}

export function make<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Config<Input, Output, Structured>): Definition<Input, Structured>
export function make(config: DynamicConfig): AnyTool
export function make(config: Config<any, any, any> | DynamicConfig): AnyTool {
  if ("jsonSchema" in config)
    return Tool.make({
      ...config,
      execute: (input, context) => Effect.promise(() => config.execute(input, context)),
    })
  return Tool.make({
    ...config,
    execute: (input, context) => Effect.promise(() => config.execute(input, context)),
  })
}

export const withPermission = Tool.withPermission

export interface ToolExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  input: unknown
}

export interface ToolExecuteAfterEvent {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  readonly input: unknown
  result: ToolResultValue
  output?: ToolOutput
  outputPaths?: ReadonlyArray<string>
}

export interface RegisterOptions {
  readonly group?: string
  readonly deferred?: boolean
}

export interface ToolDraft {
  add(name: string, tool: AnyTool, options?: RegisterOptions): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
