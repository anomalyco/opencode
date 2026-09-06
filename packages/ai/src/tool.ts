import { Effect, JsonSchema, Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import type {
  ToolCallPart,
  ToolDefinition as ToolDefinitionClass,
  ToolFreeform,
  ToolOutput as ToolOutputType,
} from "./schema/index.js"
import { ToolDefinition, ToolFailure, ToolOutput } from "./schema/index.js"

/**
 * Schema constraint for tool parameters / success values: no decoding or
 * encoding services are allowed. Tools should be self-contained — anything
 * beyond pure data conversion belongs in the handler closure.
 */
export type ToolSchema<T> = Schema.Codec<T, any, never, never>
type StringKeys<Value> = Extract<
  { [Key in keyof Value]-?: Value[Key] extends string ? Key : never }[keyof Value],
  string
>
export type Freeform<Parameters extends ToolSchema<any>> = Omit<ToolFreeform, "input"> & {
  readonly input: unknown extends Schema.Schema.Type<Parameters> ? string : StringKeys<Schema.Schema.Type<Parameters>>
}
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
) => ReadonlyArray<Tool.Content>

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
export interface Definition<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly freeform?: Freeform<Parameters>
  readonly execute?: ToolExecute<Parameters, Success>
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
  /** @internal */
  readonly _decode: (input: unknown) => Effect.Effect<Schema.Schema.Type<Parameters>, Schema.SchemaError>
  /** @internal */
  readonly _encode: (value: Schema.Schema.Type<Success>) => Effect.Effect<unknown, Schema.SchemaError>
  /** @internal */
  readonly _project: (
    parameters: Schema.Schema.Type<Parameters>,
    id: ToolCallPart["id"],
    output: unknown,
  ) => ToolOutputType
  /** @internal */
  readonly _legacyResult: boolean
  /** @internal */
  readonly _definition: ToolDefinitionClass
}

export type AnyTool = Definition<any, any>

export type ExecutableTool<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = Definition<
  Parameters,
  Success
> & {
  readonly execute: ToolExecute<Parameters, Success>
}

export type AnyExecutableTool = ExecutableTool<any, any>

export type ExecutableTools = Record<string, AnyExecutableTool>

type TypedToolConfig = {
  readonly description: string
  readonly parameters: ToolSchema<any>
  readonly success: ToolSchema<any>
  readonly freeform?: ToolFreeform
  readonly execute?: ToolExecute<ToolSchema<any>, ToolSchema<any>>
  readonly toModelOutput?: ToolToModelOutput<ToolSchema<any>, ToolSchema<any>>
  readonly toStructuredOutput?: (output: unknown) => unknown
}

type DynamicToolConfig = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly freeform?: ToolFreeform
  readonly execute?: (params: unknown, context?: ToolExecuteContext) => Effect.Effect<unknown, ToolFailure>
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<Tool.Content>
  readonly toStructuredOutput?: (output: unknown) => unknown
}

/**
 * Constructs a tool. Two input modes:
 *
 * 1. **Typed** — pass Effect `parameters` and `success` Schemas; inputs and
 *    outputs are statically typed and decoded/encoded automatically.
 *
 *    ```ts
 *    Tool.make({
 *      description: "Get current weather",
 *      parameters: Schema.Struct({ city: Schema.String }),
 *      success: Schema.Struct({ temperature: Schema.Number }),
 *      execute: ({ city }) => Effect.succeed({ temperature: 22 }),
 *    })
 *    ```
 *
 * 2. **Dynamic** — pass raw JSON Schema as `jsonSchema`. Use this when the
 *    schema comes from an external source (MCP server, plugin manifest,
 *    dynamic config) and is not known at compile time. Inputs are typed as
 *    `unknown`; the handler is responsible for any validation it needs.
 *
 *    ```ts
 *    Tool.make({
 *      description: "Look something up",
 *      jsonSchema: { type: "object", properties: { ... } },
 *      execute: (params) => Effect.succeed(...),
 *    })
 *    ```
 *
 * In both modes the produced tool flows through `toDefinitions(...)`
 * identically.
 */
export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly freeform?: Freeform<Parameters>
  readonly execute: ToolExecute<Parameters, Success>
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
}): ExecutableTool<Parameters, Success>
export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly freeform?: Freeform<Parameters>
  readonly execute?: undefined
  readonly toModelOutput?: ToolToModelOutput<Parameters, Success>
  readonly toStructuredOutput?: (output: Success["Encoded"]) => unknown
}): Definition<Parameters, Success>
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly freeform?: ToolFreeform
  readonly execute: (params: unknown, context?: ToolExecuteContext) => Effect.Effect<unknown, ToolFailure>
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<Tool.Content>
  readonly toStructuredOutput?: (output: unknown) => unknown
}): AnyExecutableTool
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly freeform?: ToolFreeform
  readonly execute?: undefined
  readonly toModelOutput?: (input: ToolModelOutputInput<unknown, unknown>) => ReadonlyArray<Tool.Content>
  readonly toStructuredOutput?: (output: unknown) => unknown
}): AnyTool
export function make(config: TypedToolConfig | DynamicToolConfig): AnyTool {
  if ("jsonSchema" in config) {
    return {
      description: config.description,
      parameters: Schema.Unknown as ToolSchema<unknown>,
      success: Schema.Unknown as ToolSchema<unknown>,
      freeform: config.freeform,
      execute: config.execute,
      toModelOutput: config.toModelOutput,
      toStructuredOutput: config.toStructuredOutput,
      _decode: Effect.succeed,
      _encode: Effect.succeed,
      _project: (parameters, id, output) =>
        project(config.toModelOutput, config.toStructuredOutput, parameters, id, output),
      _legacyResult: config.toModelOutput === undefined && config.toStructuredOutput === undefined,
      _definition: new ToolDefinition({
        name: "",
        description: config.description,
        inputSchema: config.jsonSchema,
        outputSchema: config.outputSchema,
        freeform: config.freeform,
      }),
    }
  }
  return {
    description: config.description,
    parameters: config.parameters,
    success: config.success,
    freeform: config.freeform,
    execute: config.execute,
    toModelOutput: config.toModelOutput,
    toStructuredOutput: config.toStructuredOutput,
    _decode: Schema.decodeUnknownEffect(config.parameters),
    _encode: Schema.encodeEffect(config.success),
    _project: (parameters, id, output) =>
      project(config.toModelOutput, config.toStructuredOutput, parameters, id, output),
    _legacyResult: false,
    _definition: new ToolDefinition({
      name: "",
      description: config.description,
      inputSchema: toJsonSchema(config.parameters),
      outputSchema: toJsonSchema(config.success),
      freeform: config.freeform,
    }),
  }
}

/**
 * A record of named tools. The record key becomes the tool name on the wire.
 */
export type Tools = Record<string, AnyTool>

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

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

const project = (
  toModelOutput: ((input: ToolModelOutputInput<any, any>) => ReadonlyArray<Tool.Content>) | undefined,
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

export * as Tool from "./tool.js"
