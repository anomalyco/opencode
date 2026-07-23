import { Agent } from "@opencode-ai/schema/agent"
import { LLM } from "@opencode-ai/schema/llm"
import { Session } from "@opencode-ai/schema/session"
import { SessionError } from "@opencode-ai/schema/session-error"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Schema } from "effect"
import type { Hooks, Transform } from "../registration.js"

// Tools

/** A JSON-compatible value. Tool metadata and encoded outputs must be JSON. */
export type JsonValue = typeof Schema.Json.Type

/** Compact JSON metadata for tool-specific UI and client behavior. */
export type Metadata = Readonly<Record<string, JsonValue>>

export interface Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  readonly progress: (update: Progress) => Effect.Effect<void>
}

/** Live replacement metadata for a running tool. */
export type Progress = Metadata

export type StandardSchemaType<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>
export type SchemaType<A = unknown> = Schema.Codec<A, any> | StandardSchemaType<any, A> | JsonSchema.JsonSchema
type IsAny<A> = 0 extends 1 & A ? true : false
export type InputValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<infer A, any>
      ? A
      : S extends StandardSchemaV1<any, infer A>
        ? A
        : unknown
export type OutputValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<infer A, any>
      ? A
      : S extends StandardSchemaV1<infer A, any>
        ? A
        : unknown
export type EncodedValue<S> =
  IsAny<S> extends true
    ? any
    : S extends Schema.Codec<any, infer A>
      ? A
      : S extends StandardSchemaV1<any, infer A>
        ? A
        : unknown

type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
}

export class Failure extends Schema.TaggedErrorClass<Failure>()("LLM.ToolFailure", {
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
}) {}

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }

/** Model-facing tool content: plain text or non-empty rich content. */
export type ModelOutput = string | readonly [Content, ...Content[]]

type BaseTool<Input extends SchemaType<any>> = {
  readonly description: string
  readonly input: Input
}

export type Response<Output extends SchemaType<any>> = {
  readonly output: OutputValue<Output>
  readonly content?: ModelOutput
  readonly metadata?: Metadata
}

export type ContentResponse = {
  readonly content: ModelOutput
  readonly metadata?: Metadata
}

export type Tool<
  Input extends SchemaType<any>,
  Output extends SchemaType<any> | undefined = undefined,
> = BaseTool<Input> &
  (Output extends SchemaType<any>
    ? {
        readonly output: Output
        readonly execute: (input: InputValue<Input>, context: Context) => Effect.Effect<Response<Output>, Failure>
      }
    : {
        readonly output?: undefined
        readonly execute: (input: InputValue<Input>, context: Context) => Effect.Effect<ContentResponse, Failure>
      })

export type Any = BaseTool<any> & {
  readonly output?: SchemaType<any>
  readonly execute: (input: any, context: Context) => Effect.Effect<Response<any> | ContentResponse, Failure>
}

export function make<Input extends SchemaType<any>, Output extends SchemaType<any>>(
  config: Tool<Input, Output>,
): Tool<Input, Output>
export function make<Input extends SchemaType<any>>(config: Tool<Input>): Tool<Input>
export function make(config: Any): Any
export function make(config: Any): Any {
  return config
}

// Registration

export interface RegisterOptions {
  readonly namespace?: string
  /** Defaults to true. False exposes the tool directly to the provider. */
  readonly codemode?: boolean
  /** Permission action used for whole-tool visibility filtering. */
  readonly permission?: string
}

export interface Registration {
  readonly tool: Any
  readonly name: string
  readonly namespace?: string
  readonly permission: string
}

export const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

export const registrationEntries = (
  tools: Readonly<Record<string, Any>>,
  options?: RegisterOptions,
): Array<Registration & { readonly key: string }> =>
  Object.entries(tools).map(([name, tool]) => {
    const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
    const key =
      options?.namespace === undefined ? normalized : `${options.namespace.replaceAll(".", "_")}_${normalized}`
    return {
      key,
      name: normalized,
      namespace: options?.namespace,
      tool,
      permission: options?.permission ?? key,
    }
  })

export const validateNamespace = (namespace: string) =>
  namespace.split(".").every((segment) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(segment))
    ? Effect.void
    : Effect.fail(
        new RegistrationError({ name: namespace, message: `Invalid tool namespace: ${JSON.stringify(namespace)}` }),
      )

export const toLLMDefinition = (name: string, tool: Any): ToolDefinition => ({
  name,
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
})

// Schema interpretation

export function decodeInput(schema: SchemaType<any>, value: unknown): Effect.Effect<any, Failure> {
  if (Schema.isSchema(schema))
    return Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((error) => new Failure({ message: `Invalid tool input: ${error.message}` })),
    )
  if (isStandardSchema(schema)) return validateStandard(schema, value, "Invalid tool input")
  return Effect.succeed(value)
}

export function encodeOutput(schema: SchemaType<any>, value: unknown): Effect.Effect<any, Failure> {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) => new Failure({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  if (isStandardSchema(schema))
    return validateStandard(schema, value, "Tool returned an invalid value for its output schema")
  return Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      (error) => new Failure({ message: `Tool returned a non-JSON value for its output schema: ${error.message}` }),
    ),
  )
}

function isStandardSchema(schema: SchemaType<any>): schema is StandardSchemaType {
  return "~standard" in schema
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
  if (isStandardSchema(schema))
    return schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return Schema.isSchema(schema) ? toJsonSchema(schema) : (schema as JsonSchema.JsonSchema)
}

function outputJsonSchema(schema: SchemaType<any>): JsonSchema.JsonSchema {
  if (isStandardSchema(schema))
    return schema["~standard"].jsonSchema.output({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return Schema.isSchema(schema) ? toJsonSchema(schema) : (schema as JsonSchema.JsonSchema)
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

// Plugin events

export interface ToolExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  input: unknown
}

type ToolHookBase = {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly callID: string
  readonly input: unknown
}

export const ExecuteAfterOutcome = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    content: Schema.NonEmptyArray(LLM.ToolContent),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
    outputPaths: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    error: SessionError.Error,
    content: Schema.optional(Schema.NonEmptyArray(LLM.ToolContent)),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
    outputPaths: Schema.optional(Schema.Array(Schema.String)),
  }),
]).pipe(Schema.toTaggedUnion("status"))

type Mutable<A> = { -readonly [K in keyof A]: A[K] }
type HookOutcome<A extends { readonly status: string }> = Omit<Mutable<A>, "status"> & Pick<A, "status">

/** The bounded terminal outcome exposed to tool hooks. */
export type Outcome = typeof ExecuteAfterOutcome.Type extends infer A
  ? A extends { readonly status: string }
    ? HookOutcome<A>
    : never
  : never

/**
 * The canonical execution outcome as seen by `execute.after` hooks. Hooks
 * observe bounded model content, optional metadata, and managed output paths;
 * they never observe the raw domain output.
 */
export type ToolExecuteAfterEvent = ToolHookBase & Outcome

export interface ToolDraft {
  add(name: string, tool: Any, options?: RegisterOptions): void
}

export interface ToolHooks {
  readonly "execute.before": ToolExecuteBeforeEvent
  readonly "execute.after": ToolExecuteAfterEvent
}

export interface ToolDomain {
  readonly transform: Transform<ToolDraft>
  readonly hook: Hooks<ToolHooks>
}
