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
 * Schema constraint for tool input / success values: no decoding or
 * encoding services are allowed. Tools should be self-contained — anything
 * beyond pure data conversion belongs in the handler closure.
 */
export type ToolSchema<T> = Schema.Codec<T, any, never, never>

/** A tool's `input`: an Effect Schema decodes and types it; a raw JSON Schema leaves it `unknown`. */
export type ToolInput = ToolSchema<any> | JsonSchema.JsonSchema

/** The value `execute` receives for a tool `input`. */
export type ToolInputType<Input extends ToolInput> = Input extends ToolSchema<infer T> ? T : unknown

export interface ToolExecuteContext {
  readonly id: ToolCallPart["id"]
  readonly name: ToolCallPart["name"]
  readonly namespace?: ToolCallPart["namespace"]
}

export type ToolExecute<Input extends ToolInput, Success extends ToolSchema<any>> = (
  input: ToolInputType<Input>,
  context?: ToolExecuteContext,
) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>

export interface ToolModelOutputInput<Input, Output> {
  readonly id: ToolCallPart["id"]
  readonly input: Input
  readonly output: Output
}

export type ToolToModelOutput<Input extends ToolInput, Success extends ToolSchema<any>> = (
  result: ToolModelOutputInput<ToolInputType<Input>, Success["Encoded"]>,
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

/** `Freeform` for exactly one required string field or unknown ones (a JSON Schema `input`), otherwise `undefined`. */
export type FreeformOption<Input extends ToolInput> =
  unknown extends ToolInputType<Input>
    ? Freeform
    : [FreeformField<ToolInputType<Input>>] extends [never]
      ? undefined
      : Freeform

/**
 * A type-safe LLM tool. Each tool bundles its own description, input
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
export interface Tool<Input extends ToolInput = any, Success extends ToolSchema<any> = any> {
  /** The tool name the model sees and calls. */
  readonly name: string
  readonly description: string
  readonly input: Input
  readonly success: Success
  readonly execute?: ToolExecute<Input, Success>
  readonly toModelOutput?: ToolToModelOutput<Input, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
  /** @internal */
  readonly _decode: (input: unknown) => Effect.Effect<ToolInputType<Input>, Schema.SchemaError>
  // Method syntax keeps these parameters bivariant, so a concrete tool stays assignable to `ExecutableTool`.
  /** @internal */
  _encode(value: Schema.Schema.Type<Success>): Effect.Effect<unknown, Schema.SchemaError>
  /** @internal */
  _project(input: ToolInputType<Input>, id: ToolCallPart["id"], output: unknown): ToolOutputType
  /** @internal */
  readonly _legacyResult: boolean
  /** @internal */
  readonly _definition: ToolDefinitionClass
}

/** A tool with an `execute` handler, which `LLM.loop` and `ToolRuntime.dispatch` can run. */
export type ExecutableTool<Input extends ToolInput = any, Success extends ToolSchema<any> = any> = Tool<
  Input,
  Success
> & {
  readonly execute: ToolExecute<Input, Success>
}

/**
 * Options for `tool`, where `Execute` is the only part that differs between the Effect and Promise clients. Pass an
 * Effect Schema `input` (and optionally a `success` schema that validates the result, otherwise it is sent as is with
 * `undefined` as `null`), or a raw JSON Schema `input` known only at runtime, such as an MCP tool's, with an optional
 * JSON Schema `outputSchema`. Omit `execute` to declare a tool the model can call without running it here.
 */
export type ToolOptions<
  Input extends ToolInput,
  Success extends ToolSchema<any>,
  Execute = ToolExecute<Input, Success>,
> = {
  readonly name: string
  readonly description: string
  readonly input: Input
  readonly freeform?: FreeformOption<Input>
  readonly execute?: Execute
  readonly toModelOutput?: ToolToModelOutput<Input, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
} & (Input extends ToolSchema<any> ? { readonly success?: Success } : { readonly outputSchema?: JsonSchema.JsonSchema })

/**
 * Constructs a tool whose `execute` returns an Effect that fails with `ToolFailure`.
 *
 * ```ts
 * tool({
 *   name: "weather",
 *   description: "Get current weather",
 *   input: Schema.Struct({ city: Schema.String }),
 *   success: Schema.Struct({ temperature: Schema.Number }),
 *   execute: ({ city }) => Effect.succeed({ temperature: 22 }),
 * })
 * ```
 */
export const tool = <
  Input extends ToolInput = typeof Schema.Unknown,
  Success extends ToolSchema<any> = typeof Schema.Unknown,
  Result extends Effect.Effect<Schema.Schema.Type<Success>, ToolFailure> | NoExecute = NoExecute,
>(
  config: ToolOptions<Input, Success, (input: ToolInputType<Input>, context?: ToolExecuteContext) => Result>,
) => build(config, config.execute)

declare const noExecute: unique symbol
/** @internal The inferred `execute` result when `execute` is omitted; no function can return it. */
export type NoExecute = { readonly [noExecute]: never }

/** @internal Builds a tool for both clients from its options and an Effect `execute`. */
export function build<Input extends ToolInput, Success extends ToolSchema<any>, Result>(
  config: ToolOptions<Input, Success, (...args: never) => Result>,
  execute: ((input: ToolInputType<Input>, context?: ToolExecuteContext) => unknown) | undefined,
): 0 extends 1 & Result // `any`
  ? ExecutableTool<Input, Success>
  : [Result, NoExecute] extends [NoExecute, Result]
    ? Tool<Input, Success>
    : ExecutableTool<Input, Success>
export function build(
  config: Omit<ToolOptions<ToolInput, ToolSchema<any>, unknown>, "success" | "outputSchema"> & {
    readonly success?: ToolSchema<any>
    readonly outputSchema?: JsonSchema.JsonSchema
  },
  execute: ((input: any, context?: ToolExecuteContext) => any) | undefined,
): Tool {
  const shared = {
    name: config.name,
    description: config.description,
    execute,
    toModelOutput: config.toModelOutput,
    toStructuredOutput: config.toStructuredOutput,
    _project: (input: unknown, id: ToolCallPart["id"], output: unknown) =>
      project(config.toModelOutput, config.toStructuredOutput, input, id, output),
  }
  const input = config.input
  if (!Schema.isSchema(input))
    return {
      ...shared,
      input,
      success: Schema.Unknown,
      _decode: Effect.succeed,
      _encode: Effect.succeed,
      _legacyResult: config.toModelOutput === undefined && config.toStructuredOutput === undefined,
      _definition: definition({
        name: config.name,
        description: config.description,
        inputSchema: input,
        outputSchema: config.outputSchema,
        freeform: config.freeform,
      }),
    }
  return {
    ...shared,
    input,
    success: config.success ?? Schema.Unknown,
    _decode: Schema.decodeUnknownEffect(input),
    _encode: config.success ? Schema.encodeEffect(config.success) : (value) => Effect.succeed(value ?? null),
    _legacyResult: false,
    _definition: definition({
      name: config.name,
      description: config.description,
      inputSchema: emptyInputJsonSchema(input) ?? toJsonSchema(input),
      outputSchema: config.success && toJsonSchema(config.success),
      freeform: config.freeform,
    }),
  }
}

/** The `ToolDefinition[]` that `LLMRequest.tools` expects, in array order. */
export const toDefinitions = (tools: ReadonlyArray<Tool>): ReadonlyArray<ToolDefinitionClass> =>
  tools.map((item) => item._definition)

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
  input: unknown,
  id: ToolCallPart["id"],
  output: unknown,
): ToolOutputType =>
  ToolOutput.make(
    toStructuredOutput?.(output) ?? output,
    toModelOutput?.({ id, input, output }) ?? (typeof output === "string" ? [{ type: "text", text: output }] : []),
  )

export { ToolFailure }
