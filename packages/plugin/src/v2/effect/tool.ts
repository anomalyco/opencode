export * as Tool from "./tool.js"

import { Agent } from "@opencode-ai/schema/agent"
import type { LLM } from "@opencode-ai/schema/llm"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Schema } from "effect"
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

export type StandardSchemaType<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>
export type SchemaType<A> = Schema.Codec<A, any> | StandardSchemaType<any, A>
type IsAny<A> = 0 extends 1 & A ? true : false
export type InputValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<infer A, any>
      ? A
      : S extends StandardSchemaV1<any, infer A>
        ? A
        : never
export type OutputValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<infer A, any>
      ? A
      : S extends StandardSchemaV1<infer A, any>
        ? A
        : never
export type EncodedValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<any, infer A>
      ? A
      : S extends StandardSchemaV1<any, infer A>
        ? A
        : never

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

export type Definition<
  Input extends SchemaType<any>,
  Structured extends SchemaType<any>,
  Output extends SchemaType<any> = any,
> = {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly structured?: Structured
  readonly permission?: string
  readonly toStructuredOutput?: (input: {
    readonly input: InputValue<Input>
    readonly output: EncodedValue<Output>
  }) => OutputValue<Structured>
  readonly execute: (input: InputValue<Input>, context: Context) => Effect.Effect<OutputValue<Output>, Failure>
  readonly toModelOutput?: (input: {
    readonly input: InputValue<Input>
    readonly output: EncodedValue<Output>
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
export type DynamicDefinition = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly permission?: string
  readonly execute: (input: unknown, context: Context) => Effect.Effect<DynamicOutput, Failure>
}

export type AnyTool = Definition<any, any> | DynamicDefinition

export function make<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Definition<Input, Structured, Output>): Definition<Input, Structured, Output>
export function make(config: DynamicDefinition): DynamicDefinition
export function make(config: AnyTool): AnyTool
export function make(config: AnyTool): AnyTool {
  return config
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

export const withPermission = <T extends AnyTool>(
  tool: T,
  permission: string,
): Omit<T, "permission"> & {
  readonly permission: string
} => ({ ...tool, permission })

export const permission = (tool: AnyTool, name: string) => tool.permission ?? name

export const definition = (name: string, tool: AnyTool): ToolDefinition =>
  "jsonSchema" in tool
    ? {
        name,
        description: tool.description,
        inputSchema: tool.jsonSchema,
        outputSchema: tool.outputSchema,
      }
    : {
        name,
        description: tool.description,
        inputSchema: inputJsonSchema(tool.input),
        outputSchema: outputJsonSchema(tool.structured ?? tool.output),
      }

export const settle = (tool: AnyTool, call: ToolCall, context: Context): Effect.Effect<ToolOutput, Failure> =>
  Effect.gen(function* () {
    if ("jsonSchema" in tool) {
      const output = yield* tool.execute(call.input, context)
      return { structured: output.structured, content: output.content.map(toModelContent) }
    }

    const input = yield* decodeInput(tool.input, call.input)
    const value = yield* tool.execute(input, context)
    const output = yield* encodeOutput(tool.output, value)
    const structured =
      tool.structured && tool.toStructuredOutput
        ? yield* encodeOutput(tool.structured, tool.toStructuredOutput({ input, output }))
        : output
    return {
      structured,
      content:
        tool.toModelOutput?.({ input, output }).map(toModelContent) ??
        (typeof output === "string" ? [{ type: "text" as const, text: output }] : []),
    }
  })

function decodeInput(schema: SchemaType<any>, value: unknown): Effect.Effect<any, Failure> {
  if (Schema.isSchema(schema))
    return Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((error) => new Failure({ message: `Invalid tool input: ${error.message}` })),
    )
  return validateStandard(schema, value, "Invalid tool input")
}

function encodeOutput(schema: SchemaType<any>, value: unknown): Effect.Effect<any, Failure> {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) => new Failure({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  return validateStandard(schema, value, "Tool returned an invalid value for its output schema")
}

function validateStandard(schema: StandardSchemaType, value: unknown, prefix: string): Effect.Effect<unknown, Failure> {
  return Effect.gen(function* () {
    const pending = yield* Effect.try({
      try: () => schema["~standard"].validate(value),
      catch: (error) => standardFailure(prefix, error),
    })
    const result =
      pending instanceof Promise
        ? yield* Effect.tryPromise({ try: () => pending, catch: (error) => standardFailure(prefix, error) })
        : pending
    if (result.issues)
      return yield* Effect.fail(
        new Failure({ message: `${prefix}: ${result.issues.map((issue) => issue.message).join(", ")}` }),
      )
    return result.value
  })
}

function standardFailure(prefix: string, error: unknown) {
  return new Failure({ message: `${prefix}: ${error instanceof Error ? error.message : String(error)}` })
}

function inputJsonSchema(schema: SchemaType<any>): JsonSchema.JsonSchema {
  if (!Schema.isSchema(schema))
    return schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return toJsonSchema(schema)
}

function outputJsonSchema(schema: SchemaType<any>): JsonSchema.JsonSchema {
  if (!Schema.isSchema(schema))
    return schema["~standard"].jsonSchema.output({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return toJsonSchema(schema)
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
