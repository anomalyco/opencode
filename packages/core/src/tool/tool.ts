export * as Tool from "./tool"

import { ToolDefinition, ToolFailure, ToolOutput, type ToolCall } from "@opencode-ai/llm"
import { Effect, JsonSchema, Schema } from "effect"
import type { AgentV2 } from "../agent"
import type { SessionMessage } from "../session/message"
import type { SessionSchema } from "../session/schema"

export interface Context {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
}

export type SchemaType<A> = Schema.Codec<A, any, never, never>

declare const TypeId: unique symbol

export interface Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly _Input: Input
    readonly _Output: Output
  }
}

export type AnyTool = Definition<any, any>
export const Failure = ToolFailure
export type Failure = ToolFailure

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
  ) => Effect.Effect<Schema.Schema.Type<Output>, ToolFailure>
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
  readonly execute: (input: unknown, context: Context) => Effect.Effect<DynamicOutput, ToolFailure>
}

type Runtime = {
  readonly permission?: string
  readonly definition: (name: string) => ToolDefinition
  readonly settle: (call: ToolCall, context: Context) => Effect.Effect<ToolOutput, ToolFailure>
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
      const definition = new ToolDefinition({
        name,
        description: config.description,
        inputSchema: toJsonSchema(config.input),
        outputSchema: toJsonSchema(config.structured ?? config.output),
      })
      definitions.set(name, definition)
      return definition
    },
    settle: (call, context) =>
      Schema.decodeUnknownEffect(config.input)(call.input).pipe(
        Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
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
                    new ToolFailure({
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
      const definition = new ToolDefinition({
        name,
        description: config.description,
        inputSchema: config.jsonSchema,
        outputSchema: config.outputSchema,
      })
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

export const registrationEntries = (tools: Readonly<Record<string, AnyTool>>) =>
  Object.entries(tools).map(([name, tool]) => [name.replace(/[^a-zA-Z0-9_-]/g, "_"), tool] as const)

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
  if (!runtime) throw new TypeError("Invalid Core Tool value")
  return runtime
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}
