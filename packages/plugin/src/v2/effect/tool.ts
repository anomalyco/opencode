export * as Tool from "./tool.js"

import { Agent } from "@opencode-ai/schema/agent"
import type { LLM } from "@opencode-ai/schema/llm"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, JsonSchema, Schema, type Scope } from "effect"
import type { Hooks, Transform } from "./registration.js"

export interface Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  readonly progress: (update: Progress) => Effect.Effect<void>
}

export interface Progress {
  readonly structured: Readonly<Record<string, unknown>>
  readonly content?: ReadonlyArray<Content>
}

export type SchemaType<A> = Schema.Codec<A, any>

type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
}

type ToolCall = {
  readonly input: unknown
  readonly [key: string]: unknown
}

type ToolResultValue =
  | { readonly type: "json"; readonly value: unknown }
  | { readonly type: "text"; readonly value: unknown }
  | { readonly type: "error"; readonly value: unknown }
  | { readonly type: "content"; readonly value: ReadonlyArray<LLM.ToolContent> }

type ToolOutput = {
  readonly structured: unknown
  readonly content: ReadonlyArray<LLM.ToolContent>
}

declare const TypeId: unique symbol

export interface Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly _Input: Input
    readonly _Output: Output
  }
}

export type AnyTool = Definition<any, any>
export class Failure extends Schema.TaggedErrorClass<Failure>()("LLM.ToolFailure", {
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }

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
  ) => Effect.Effect<Schema.Schema.Type<Output>, Failure>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}

export type DynamicOutput = {
  readonly structured: unknown
  readonly content: ReadonlyArray<Content>
}

/**
 * Config for a tool whose input shape is a raw JSON Schema not known at compile
 * time (MCP servers, plugin manifests). Input is passed through as `unknown`;
 * `execute` returns the already-projected structured value and model content.
 */
type DynamicConfig = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly execute: (input: unknown, context: Context) => Effect.Effect<DynamicOutput, Failure>
}

type Runtime = {
  readonly permission?: string
  readonly definition: (name: string) => ToolDefinition
  readonly settle: (call: ToolCall, context: Context) => Effect.Effect<ToolOutput, Failure>
}

const runtimes = new WeakMap<AnyTool, Runtime>()

export function make<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Config<Input, Output, Structured>): Definition<Input, Structured>
export function make(config: DynamicConfig): AnyTool
export function make(config: Config<any, any, any> | DynamicConfig): AnyTool {
  if ("jsonSchema" in config) return makeDynamic(config)
  return makeTyped(config)
}

function makeTyped<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Config<Input, Output, Structured>): Definition<Input, Structured> {
  const tool = Object.freeze({}) as Definition<Input, Structured>
  const definitions = new Map<string, ToolDefinition>()
  runtimes.set(tool, {
    definition: (name) => {
      const cached = definitions.get(name)
      if (cached) return cached
      const definition: ToolDefinition = {
        name,
        description: config.description,
        inputSchema: toJsonSchema(config.input),
        outputSchema: toJsonSchema(config.structured ?? config.output),
      }
      definitions.set(name, definition)
      return definition
    },
    settle: (call, context) =>
      Schema.decodeUnknownEffect(config.input)(call.input).pipe(
        Effect.mapError((error) => new Failure({ message: `Invalid tool input: ${error.message}` })),
        Effect.flatMap((input) =>
          config.execute(input, context).pipe(
            Effect.flatMap((output) =>
              Schema.encodeEffect(config.output)(output).pipe(
                Effect.flatMap((output) => {
                  if (!config.structured || !config.toStructuredOutput)
                    return Effect.succeed({ output, structured: output })
                  return Schema.encodeEffect(config.structured)(config.toStructuredOutput({ input, output })).pipe(
                    Effect.map((structured) => ({ output, structured })),
                  )
                }),
                Effect.mapError(
                  (error) =>
                    new Failure({
                      message: `Tool returned an invalid value for its output schema: ${error.message}`,
                    }),
                ),
              ),
            ),
            Effect.map(({ output, structured }) => ({
              structured,
              content:
                config.toModelOutput?.({ input, output }).map(toModelContent) ??
                (typeof output === "string" ? [{ type: "text" as const, text: output }] : []),
            })),
          ),
        ),
      ),
  })
  return tool
}

function makeDynamic(config: DynamicConfig): AnyTool {
  const tool = Object.freeze({}) as AnyTool
  const definitions = new Map<string, ToolDefinition>()
  runtimes.set(tool, {
    definition: (name) => {
      const cached = definitions.get(name)
      if (cached) return cached
      const definition: ToolDefinition = {
        name,
        description: config.description,
        inputSchema: config.jsonSchema,
        outputSchema: config.outputSchema,
      }
      definitions.set(name, definition)
      return definition
    },
    settle: (call, context) =>
      config
        .execute(call.input, context)
        .pipe(Effect.map((output) => ({ structured: output.structured, content: output.content.map(toModelContent) }))),
  })
  return tool
}

function toModelContent(part: Content) {
  if (part.type === "text") return { type: "text" as const, text: part.text }
  return { type: "file" as const, uri: `data:${part.mime};base64,${part.data}`, mime: part.mime, name: part.name }
}

export const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

export const registrationEntries = (tools: Readonly<Record<string, AnyTool>>, group?: string) =>
  Object.entries(tools).map(([name, tool]) => {
    const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
    const parent = group?.replace(/[^a-zA-Z0-9_-]/g, "_")
    return {
      key: parent === undefined ? normalized : `${parent}_${normalized}`,
      name: normalized,
      group: parent,
      tool,
    }
  })

export const withPermission = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  permission: string,
) => {
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, { ...runtimeOf(tool), permission })
  return decorated
}

export const permission = (tool: AnyTool, name: string) => runtimeOf(tool).permission ?? name
export const definition = (name: string, tool: AnyTool) => runtimeOf(tool).definition(name)
export const settle = (tool: AnyTool, call: ToolCall, context: Context) => runtimeOf(tool).settle(call, context)

function runtimeOf(tool: AnyTool) {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid Tool value")
  return runtime
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

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
  result: ToolResultValue
  output?: ToolOutput
  outputPaths?: ReadonlyArray<string>
}

export interface RegisterOptions {
  readonly group?: string
  /** Defaults to true. False exposes the tool directly to the provider. */
  readonly codemode?: boolean
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
