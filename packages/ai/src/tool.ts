import { Effect, JsonSchema, Schema } from "effect"
import type { Content } from "@opencode/schema/tool"
import type {
  Freeform,
  ToolCallPart,
  ToolDefinition as ToolDefinitionClass,
  ToolOutput as ToolOutputType,
} from "./schema/index.js"
import { ToolDefinition, ToolFailure, ToolOutput, type ToolDefinitionInput } from "./schema/index.js"
import { isRecord } from "./utils/record.js"

/**
 * Schema constraint for tool parameters / success values: no decoding or
 * encoding services are allowed. Tools should be self-contained — anything
 * beyond pure data conversion belongs in the handler closure.
 */
export type ToolSchema<T> = Schema.Codec<T, any, never, never>
export interface ToolExecuteContext {
  readonly id: ToolCallPart["id"]
  readonly name: ToolCallPart["name"]
  readonly namespace?: ToolCallPart["namespace"]
}

export type ToolExecute<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = (
  params: Schema.Schema.Type<Parameters>,
  context?: ToolExecuteContext,
) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>

export interface ToolModelOutputInput<Parameters, Output> {
  readonly id: ToolCallPart["id"]
  readonly parameters: Parameters
  readonly output: Output
}

export type ToolToModelOutput<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = (
  input: ToolModelOutputInput<Schema.Schema.Type<Parameters>, Success["Encoded"]>,
) => ReadonlyArray<Content>

type FreeformField<T> = {
  [K in keyof T]-?: [Exclude<keyof T, K>] extends [never]
    ? {} extends Pick<T, K>
      ? never
      : T[K] extends string
        ? K
        : never
    : never
}[keyof T]

/** `Freeform` for exactly one required string parameter or unknown ones (`jsonSchema`), otherwise `undefined`. */
export type FreeformOption<Parameters extends ToolSchema<any>> =
  unknown extends Schema.Schema.Type<Parameters>
    ? Freeform
    : [FreeformField<Schema.Schema.Type<Parameters>>] extends [never]
      ? undefined
      : Freeform

/**
 * A type-safe LLM tool. Each tool bundles its own description, parameter
 * Schema and success Schema. The execute handler is optional: omit it when you
 * only want to expose a tool schema to the model and handle tool calls outside
 * this package.
 *
 * Errors must be expressed as `ToolFailure`. Unmapped errors and defects fail
 * the stream.
 *
 * Internally each tool also carries memoized codecs and a precomputed
 * `ToolDefinition` so callers do not rebuild them per invocation.
 */
export interface Tool<Parameters extends ToolSchema<any> = any, Success extends ToolSchema<any> = any> {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute?: ToolExecute<Parameters, Success>
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
  /** @internal */
  readonly _decode: (input: unknown) => Effect.Effect<Schema.Schema.Type<Parameters>, Schema.SchemaError>
  // Method syntax keeps these parameters bivariant, so a concrete tool stays assignable to `ExecutableTool`.
  /** @internal */
  _encode(value: Schema.Schema.Type<Success>): Effect.Effect<unknown, Schema.SchemaError>
  /** @internal */
  _project(parameters: Schema.Schema.Type<Parameters>, id: ToolCallPart["id"], output: unknown): ToolOutputType
  /** @internal */
  readonly _legacyResult: boolean
  /** @internal */
  readonly _definition: ToolDefinitionClass
}

/** A tool with an `execute` handler, which `LLM.loop` and `ToolRuntime.dispatch` can run. */
export type ExecutableTool<Parameters extends ToolSchema<any> = any, Success extends ToolSchema<any> = any> = Tool<
  Parameters,
  Success
> & {
  readonly execute: ToolExecute<Parameters, Success>
}

/**
 * Options for `tool`, where `Execute` is the only part that differs between the Effect and Promise clients. Pass
 * Effect `parameters` (and optionally a `success` schema that validates the result, otherwise it is sent as is with
 * `undefined` as `null`), or raw `jsonSchema` known only at runtime, such as an MCP tool's. Omit `execute` to declare
 * a tool the model can call without running it here.
 */
export type ToolOptions<
  Parameters extends ToolSchema<any>,
  Success extends ToolSchema<any>,
  Execute = ToolExecute<Parameters, Success>,
> = {
  readonly description: string
  readonly freeform?: FreeformOption<Parameters>
  readonly execute?: Execute
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
} & (
  | { readonly parameters: Parameters; readonly success?: Success }
  | { readonly jsonSchema: JsonSchema.JsonSchema; readonly outputSchema?: JsonSchema.JsonSchema }
)

/**
 * Constructs a tool whose `execute` returns an Effect that fails with `ToolFailure`.
 *
 * ```ts
 * tool({
 *   description: "Get current weather",
 *   parameters: Schema.Struct({ city: Schema.String }),
 *   success: Schema.Struct({ temperature: Schema.Number }),
 *   execute: ({ city }) => Effect.succeed({ temperature: 22 }),
 * })
 * ```
 */
export const tool = <
  Parameters extends ToolSchema<any> = typeof Schema.Unknown,
  Success extends ToolSchema<any> = typeof Schema.Unknown,
  Result extends Effect.Effect<Schema.Schema.Type<Success>, ToolFailure> | NoExecute = NoExecute,
>(
  config: ToolOptions<
    Parameters,
    Success,
    (params: Schema.Schema.Type<Parameters>, context?: ToolExecuteContext) => Result
  >,
) => build(config, config.execute)

declare const noExecute: unique symbol
/** @internal The inferred `execute` result when `execute` is omitted; no function can return it. */
export type NoExecute = { readonly [noExecute]: never }

/** @internal Builds a tool for both clients from its options and an Effect `execute`. */
export function build<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>, Result>(
  config: ToolOptions<Parameters, Success, (...args: never) => Result>,
  execute: ((params: Schema.Schema.Type<Parameters>, context?: ToolExecuteContext) => unknown) | undefined,
): 0 extends 1 & Result // `any`
  ? ExecutableTool<Parameters, Success>
  : [Result, NoExecute] extends [NoExecute, Result]
    ? Tool<Parameters, Success>
    : ExecutableTool<Parameters, Success>
export function build(
  config: ToolOptions<ToolSchema<any>, ToolSchema<any>, unknown>,
  execute: ((params: any, context?: ToolExecuteContext) => any) | undefined,
): Tool {
  const shared = {
    description: config.description,
    execute,
    toModelOutput: config.toModelOutput,
    toStructuredOutput: config.toStructuredOutput,
    _project: (parameters: unknown, id: ToolCallPart["id"], output: unknown) =>
      project(config.toModelOutput, config.toStructuredOutput, parameters, id, output),
  }
  if ("jsonSchema" in config)
    return {
      ...shared,
      parameters: Schema.Unknown,
      success: Schema.Unknown,
      _decode: Effect.succeed,
      _encode: Effect.succeed,
      _legacyResult: config.toModelOutput === undefined && config.toStructuredOutput === undefined,
      _definition: definition({
        name: "",
        description: config.description,
        inputSchema: config.jsonSchema,
        outputSchema: config.outputSchema,
        freeform: config.freeform,
      }),
    }
  return {
    ...shared,
    parameters: config.parameters,
    success: config.success ?? Schema.Unknown,
    _decode: Schema.decodeUnknownEffect(config.parameters),
    _encode: config.success ? Schema.encodeEffect(config.success) : (value) => Effect.succeed(value ?? null),
    _legacyResult: false,
    _definition: definition({
      name: "",
      description: config.description,
      inputSchema: emptyInputJsonSchema(config.parameters) ?? toJsonSchema(config.parameters),
      outputSchema: config.success && toJsonSchema(config.success),
      freeform: config.freeform,
    }),
  }
}

/**
 * A record of named tools. The record key becomes the tool name on the wire.
 */
export type Tools = Record<string, Tool>

/**
 * Convert a tools record into the `ToolDefinition[]` shape that
 * `LLMRequest.tools` expects.
 *
 * Tool names come from the record keys, so the per-tool cached
 * `_definition` is rebuilt with the correct name here. The JSON Schema body
 * is reused.
 */
export const toDefinitions = (tools: Tools): ReadonlyArray<ToolDefinitionClass> =>
  Object.entries(tools).map(
    ([name, item]) =>
      new ToolDefinition({
        name,
        description: item._definition.description,
        inputSchema: item._definition.inputSchema,
        outputSchema: item._definition.outputSchema,
        freeform: item._definition.freeform,
      }),
  )

/**
 * Describes a no-argument Effect tool input as an empty object, or returns
 * `undefined` when the input takes arguments.
 *
 * Effect emits `{ not: { type: "null" } }` only for an encoded struct with no
 * properties or index signatures, but providers require tool parameters to
 * describe an object. Annotations are kept; any other keyword, such as a
 * check's `minProperties`, leaves the schema as Effect emitted it.
 */
export const emptyInputJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema | undefined => {
  const { not, ...rest } = Schema.toJsonSchemaDocument(schema, { referencePolicy: () => undefined }).schema
  if (!isRecord(not) || not.type !== "null" || Object.keys(not).length !== 1) return undefined
  if (!Object.keys(rest).every((key) => annotationKeywords.has(key))) return undefined
  return { ...rest, type: "object", properties: {}, additionalProperties: false }
}

const definition = (input: ToolDefinitionInput) => {
  if (input.freeform !== undefined && ToolDefinition.freeformField(input.inputSchema) === undefined)
    throw new Error("A freeform tool needs exactly one parameter, a required string")
  return new ToolDefinition(input)
}

const annotationKeywords = new Set(["title", "description", "default", "examples", "readOnly", "writeOnly"])

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" })
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

const project = (
  toModelOutput: ((input: ToolModelOutputInput<any, any>) => ReadonlyArray<Content>) | undefined,
  toStructuredOutput: ((output: unknown) => unknown) | undefined,
  parameters: unknown,
  id: ToolCallPart["id"],
  output: unknown,
): ToolOutputType =>
  ToolOutput.make(
    toStructuredOutput?.(output) ?? output,
    toModelOutput?.({ id, parameters, output }) ?? (typeof output === "string" ? [{ type: "text", text: output }] : []),
  )

export { ToolFailure }
